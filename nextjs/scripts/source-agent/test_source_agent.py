"""Offline regression suite: no credentials, network, live scans or persistent daemon."""
import importlib.util
import json
import io
from types import SimpleNamespace
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('source_agent', Path(__file__).resolve().parents[2] / 'public/developer/tavonel-source-agent.py')
agent = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(agent)

class Client:
    bodies = []
    uploads = []
    lose_response = False
    def __init__(self, *args): pass
    def upload(self, path, mime, key, original_filename=None):
        self.uploads.append((original_filename or path.name, key))
        return '11111111-1111-4111-8111-111111111111'
    def post(self, path, body):
        self.bodies.append(body)
        if self.lose_response:
            Client.lose_response = False
            raise agent.RetryableAgentError('lost response')
        return {'status': 'replayed' if len(self.bodies) > 1 and self.bodies[-1]['batchId'] == self.bodies[-2]['batchId'] else 'applied'}

class SyncTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.root = self.base / 'documents'; self.root.mkdir()
        self.args = agent.parser().parse_args(['--root',str(self.root),'--connection-id','11111111-1111-4111-8111-111111111111','--state',str(self.base/'state.json')])
        Client.bodies=[]; Client.uploads=[]; Client.lose_response=False
        self.fake = patch.object(agent,'FoundationClient',Client); self.fake.start()
    def tearDown(self):
        self.fake.stop(); self.tmp.cleanup()
    def add(self, name='a.pdf', data=b'example'):
        (self.root/name).write_bytes(data)
    def test_unchanged_does_not_upload_or_commit(self):
        self.add(); self.assertEqual(agent.sync(self.args)['status'],'applied')
        self.assertEqual(agent.sync(self.args)['status'],'unchanged')
        self.assertEqual(len(Client.bodies),1); self.assertEqual(len(Client.uploads),1)
    def test_lost_response_replays_same_journal_before_scanning(self):
        self.add(); Client.lose_response=True
        with self.assertRaises(agent.RetryableAgentError): agent.sync(self.args)
        self.assertFalse(self.args.state.exists())
        pending=self.args.state.with_name('state.json.pending'); self.assertTrue(pending.exists())
        self.add('new.pdf')
        self.assertEqual(agent.sync(self.args)['status'],'replayed')
        self.assertEqual(Client.bodies[0],Client.bodies[1]); self.assertEqual(len(Client.uploads),1)
        self.assertFalse(pending.exists())
        self.assertEqual(agent.sync(self.args)['eventCount'],1)
    def test_changed_scope_refused(self):
        self.add(); agent.sync(self.args)
        other=self.base/'other';other.mkdir(); self.args.root=other
        with self.assertRaisesRegex(agent.AgentError,'scope changed'):agent.sync(self.args)
        self.assertEqual(len(Client.bodies),1)
    def test_empty_inventory_requires_explicit_setting(self):
        self.add();agent.sync(self.args);(self.root/'a.pdf').unlink()
        with self.assertRaisesRegex(agent.AgentError,'empty inventory'):agent.sync(self.args)
        self.args.allow_empty_snapshot=True
        self.assertEqual(agent.sync(self.args)['eventCount'],1)
        self.assertEqual(Client.bodies[-1]['events'][0]['kind'],'deleted')
    def test_incomplete_scan_never_commits_deletions(self):
        self.add();agent.sync(self.args)
        original=self.args.state.read_bytes()
        def broken(*a,**kwargs): kwargs['onerror'](PermissionError('denied'));return iter([])
        with patch.object(agent.os,'walk',broken):
            with self.assertRaises(agent.AgentError):agent.sync(self.args)
        self.assertEqual(original,self.args.state.read_bytes());self.assertEqual(len(Client.bodies),1)
    def test_symlinks_not_collected(self):
        outside=self.base/'secret.pdf';outside.write_bytes(b'secret')
        (self.root/'linked.pdf').symlink_to(outside)
        self.assertEqual(agent.scan_mount(self.root,100),{})
    def test_state_inside_source_rejected_before_write(self):
        self.args.state=self.root/'state.json'
        with self.assertRaises(agent.AgentError):agent.sync(self.args)
        self.assertEqual(list(self.root.iterdir()),[])
    def test_event_budget_before_upload(self):
        self.add();self.add('b.pdf');self.args.max_events=1
        with self.assertRaisesRegex(agent.AgentError,'budget'):agent.sync(self.args)
        self.assertEqual(Client.uploads,[]);self.assertEqual(Client.bodies,[])
    def test_byte_budget_before_upload(self):
        self.add();self.args.max_upload_bytes=1
        with self.assertRaisesRegex(agent.AgentError,'budget'):agent.sync(self.args)
        self.assertEqual(Client.uploads,[])
    def test_legacy_state_needs_explicit_adoption(self):
        self.add();agent.sync(self.args)
        state=json.loads(self.args.state.read_text());state.pop('scopeFingerprint');self.args.state.write_text(json.dumps(state))
        with self.assertRaisesRegex(agent.AgentError,'legacy state'):agent.sync(self.args)
        self.args.adopt_legacy_state=True
        # No changes: migrate only the local scope binding, without a new upload.
        self.assertEqual(agent.sync(self.args)['status'],'unchanged')
        self.assertEqual(json.loads(self.args.state.read_text())['scopeFingerprint'],agent.source_fingerprint(self.args))
    def test_lock_excludes_concurrent_writer(self):
        with agent.state_lock(self.args.state):
            with self.assertRaisesRegex(agent.AgentError,'another agent'):agent.sync(self.args)
    def test_watch_runs_bounded_cycles(self):
        self.args.watch=True;self.args.max_cycles=3; waits=[];out=[]
        with patch.object(agent,'sync',return_value={'status':'unchanged'}) as sync:
            self.assertEqual(agent.run(self.args,sleep=waits.append,emit=out.append),0)
        self.assertEqual(sync.call_count,3);self.assertEqual(waits,[30,30]);self.assertEqual(len(out),3)
    def test_retry_bounded_and_only_transient(self):
        self.args.retry_limit=2;waits=[]
        with patch.object(agent,'sync',side_effect=agent.RetryableAgentError('network')) as sync:
            with self.assertRaises(agent.RetryableAgentError):agent.run(self.args,sleep=waits.append,emit=lambda x:None)
        self.assertEqual(sync.call_count,3);self.assertEqual(waits,[1,2])
        with patch.object(agent,'sync',side_effect=agent.AgentError('auth')) as sync:
            with self.assertRaises(agent.AgentError):agent.run(self.args,sleep=waits.append,emit=lambda x:None)
        self.assertEqual(sync.call_count,1)
    def test_snapshot_rejects_change_after_inventory(self):
        self.add(data=b"old")
        expected=agent.scan_mount(self.root,100)['a.pdf']
        self.add(data=b"new")
        with self.assertRaisesRegex(agent.AgentError,'changed after inventory'):
            agent.snapshot_mount(self.root/'a.pdf',expected,100)
    def test_snapshot_upload_bytes_are_immutable(self):
        self.add(data=b"old")
        expected=agent.scan_mount(self.root,100)['a.pdf']
        snapshot,directory=agent.snapshot_mount(self.root/'a.pdf',expected,100)
        try:
            self.add(data=b"new")
            self.assertEqual(snapshot.read_bytes(),b"old")
            self.assertEqual(snapshot.name,'a.pdf')
        finally:directory.cleanup()
    def test_s3_repeated_cursor_rejected(self):
        class S3:
            def list_objects_v2(self,**kw):return {'Contents':[],'IsTruncated':True,'NextContinuationToken':'same'}
        with self.assertRaisesRegex(agent.AgentError,'repeated'):agent.scan_s3(S3(),self.args)
    def test_auth_redirect_refused(self):
        request=agent.urllib.request.Request('https://example.test/api',data=b'{}',headers={'Authorization':'Bearer fixture'})
        for target in ['https://other.test/api','http://example.test/api','https://example.test/new']:
            self.assertIsNone(agent.NoRedirect().redirect_request(request,None,302,'',{},target))
    def test_growing_read_is_bounded(self):
        self.add(data=b'123456')
        real=agent.os.stat(self.root/'a.pdf')
        fake=SimpleNamespace(st_size=0,st_mode=real.st_mode,st_mtime_ns=real.st_mtime_ns,st_ino=real.st_ino)
        with patch.object(agent.os,'fstat',return_value=fake):
            with self.assertRaisesRegex(agent.AgentError,'while reading'):
                agent.file_digest(self.root/'a.pdf',3)
    def test_s3_missing_or_malformed_completeness_rejected(self):
        for marker in [None,0,'false']:
            class S3:
                def list_objects_v2(self,**kw):return {'Contents':[],'IsTruncated':marker}
            with self.assertRaisesRegex(agent.AgentError,'completeness'):agent.scan_s3(S3(),self.args)
    def test_s3_bad_entry_rejected(self):
        class S3:
            def list_objects_v2(self,**kw):return {'Contents':[{'Key':'x','Size':None}],'IsTruncated':False}
        with self.assertRaisesRegex(agent.AgentError,'entry'):agent.scan_s3(S3(),self.args)
    def test_s3_download_pins_listed_revision(self):
        calls=[]
        class S3:
            def get_object(self,**kw):
                calls.append(kw);return {"ETag":'"abc"',"Body":io.BytesIO(b"ok")}
        path=agent.download_s3(S3(),self.args,'a.pdf',2,'etag:abc')
        try:self.assertEqual(path.read_bytes(),b'ok');self.assertEqual(calls[0]['IfMatch'],'"abc"')
        finally:path.unlink()
    def test_s3_changed_revision_refused(self):
        class S3:
            def get_object(self,**kw):return {"ETag":'"new"',"Body":io.BytesIO(b"ok")}
        with self.assertRaisesRegex(agent.AgentError,'revision changed'):
            agent.download_s3(S3(),self.args,'a.pdf',2,'etag:old')
    def test_tampered_pending_manifest_refused(self):
        self.add();Client.lose_response=True
        with self.assertRaises(agent.RetryableAgentError):agent.sync(self.args)
        pending=self.args.state.with_name('state.json.pending');v=json.loads(pending.read_text());v['body']['events']=[];pending.write_text(json.dumps(v))
        with self.assertRaisesRegex(agent.AgentError,'manifest'):agent.sync(self.args)
        self.assertEqual(len(Client.bodies),1)

if __name__=='__main__':unittest.main()
