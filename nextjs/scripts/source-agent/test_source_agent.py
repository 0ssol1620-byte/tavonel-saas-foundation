"""Offline regression suite: no credentials, network, live scans or persistent daemon.

Provenance: the initial draft of this suite was authored by Codex. Claude Opus 5.5
later revised and extended the intake-plan tests (r1), and a subsequent Claude Opus
5.5 revision (r2) rebound them to handle-anchored traversal and added the race
regressions. An r3 revision added the case-policy lookup tests and made the
ancestor-rename race assert its denial path, so the file is of mixed authorship.
No test sets or changes a directory's case sensitivity. Every fixture is synthetic and lives
in a temporary directory. The link-confinement tests create real directory junctions
on Windows with `cmd /c mklink /J` (no administrator or symlink privilege) and
directory symlinks elsewhere; every link target is inside the same temporary
directory, races only rename directories the test created, and no ACL or permission
is changed. No plan test reads file contents.

A later Claude Opus 5.5 revision moved sync uploads onto the quote/approval contract. WireTests
run the real FoundationClient and sync against a synthetic Foundation and object store served by
a ThreadingHTTPServer bound to 127.0.0.1 for the length of one test, with a synthetic key; no
request leaves the host and every socket has a bounded timeout.
"""
import hashlib
import importlib.util
import json
import io
import os
import stat
import subprocess
import sys
import socket
import threading
import time
import urllib.parse
import uuid
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('source_agent', Path(__file__).resolve().parents[2] / 'public/developer/tavonel-source-agent.py')
agent = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(agent)

IO_REPARSE_TAG_MOUNT_POINT = 0xA0000003  # Windows junction / volume mount point
FILE_SUPPORTS_REPARSE_POINTS = 0x00000080
ON_LINUX = sys.platform.startswith('linux')

def plan_policy(**budgets):
    policy = json.loads(agent.canonical(agent.PLAN_POLICY))
    policy['scanBudgets'].update(budgets)
    return policy

def canonical_temp_base(tmp):
    # The plan refuses links among the root's ancestors, so fixtures start from the canonical
    # temporary path (a junctioned %TEMP% or macOS /var would otherwise be refused up front).
    return Path(os.path.realpath(tmp.name))

def volume_supports_reparse_points(path):
    import ctypes
    flags = ctypes.c_ulong(0)
    volume = os.path.splitdrive(os.path.abspath(path))[0] + '\\'
    if not ctypes.windll.kernel32.GetVolumeInformationW(volume, None, 0, None, None, ctypes.byref(flags), None, 0):
        return False
    return bool(flags.value & FILE_SUPPORTS_REPARSE_POINTS)

def make_directory_link(test, link, target):
    """Create a real directory link without administrator or symlink privilege.

    Windows gets a junction from `cmd /c mklink /J`: a reparse point that is neither
    S_ISLNK nor os.path.islink, which is how the Codex draft was escaped. Elsewhere a
    directory symlink exercises the same confinement path. Returns the link kind the
    planner must report.
    """
    if os.name == 'nt':
        command = [os.environ.get('COMSPEC') or 'cmd.exe', '/d', '/c', 'mklink', '/J', str(link), str(target)]
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=60)
        except (OSError, subprocess.SubprocessError) as error:
            test.skipTest(f'cmd mklink /J is unavailable: {error}')
        if result.returncode != 0:
            if not volume_supports_reparse_points(link.parent):
                test.skipTest('the temporary volume does not support junctions')
            test.fail(f'mklink /J failed on a reparse-capable volume: {result.stdout}{result.stderr}')
        test.assertEqual(os.lstat(link).st_reparse_tag, IO_REPARSE_TAG_MOUNT_POINT)
        return 'reparse_point'
    try:
        os.symlink(target, link, target_is_directory=True)
    except (OSError, NotImplementedError) as error:
        test.skipTest(f'directory symlinks are unavailable: {error}')
    return 'symlink'

def remove_link(link):
    # rmdir removes a junction and unlink removes a symlink; neither touches the target.
    if os.name == 'nt': os.rmdir(link)
    else: os.unlink(link)

def rename_with_retry(source, target):
    # Indexers or antivirus can briefly hold a fresh Windows directory; retry a bounded number of times.
    for attempt in range(20):
        try:
            os.rename(source, target)
            return
        except PermissionError:
            if attempt == 19:
                raise
            time.sleep(0.05)

def traversal_backend(test):
    """The handle-anchored backend class for this host; only unsupported platforms skip."""
    try:
        return type(agent._traversal_backend())
    except agent.UnsupportedSafeTraversal as error:
        if os.name == 'nt' or ON_LINUX:
            test.fail(f'handle-anchored traversal is unavailable on a supported platform: {error.code}')
        test.skipTest(f'this platform fails closed with unsupported_safe_traversal: {error.code}')

def child(name, *, link=None, is_dir=False, size=0, mtime_ns=1):
    metadata = agent._ChildMetadata(link, is_dir, not is_dir and link is None, size, mtime_ns)
    return agent._Child(name, lambda: metadata)

def listing(children, calls=None):
    """A synthetic listing that stands in for what a held directory handle returns."""
    @contextmanager
    def fake(backend, handle):
        if calls is not None: calls.append(handle)
        yield iter(children)
    return fake

@contextmanager
def patched_children(backend, before=None, after=None, transform=None):
    """Observe or stage a race around each listing; the real listing still reads the held handle."""
    real = backend.children
    calls = []
    @contextmanager
    def children(self, handle):
        calls.append(handle)
        if before: before(len(calls))
        try:
            with real(self, handle) as iterator:
                yield transform(iterator) if transform else iterator
        finally:
            if after: after(len(calls))
    with patch.object(backend, 'children', children):
        yield calls

@contextmanager
def recorded_opens(backend, hook=None):
    """Record every single-name open beneath a held handle; hook may stage a race or refuse."""
    real = backend.open_beneath
    names = []
    def open_beneath(self, parent, name, *, listing):
        names.append(name)
        if hook:
            replaced = hook(name)
            if replaced is not None: return replaced
        return real(self, parent, name, listing=listing)
    with patch.object(backend, 'open_beneath', open_beneath):
        yield names

CONNECTION = '11111111-1111-4111-8111-111111111111'
FINGERPRINT = 'sha256:' + '7' * 64
API_KEY = 'tvnl_live_synthetic_wire_fixture'

def sha(data): return hashlib.sha256(data).hexdigest()

# The intake contract, written out here independently of the agent (lib/intake-approval.ts).
def expected_file_key(path, data, mime):
    return 'fk_' + sha('\x1f'.join(['tavonel-intake-file-v1', path, sha(data), str(len(data)), mime]).encode())[:40]

def expected_file_key_from_digest(path, content_sha256, size, mime):
    canonical='\x1f'.join(['tavonel-intake-file-v1',path,content_sha256,str(size),mime])
    return 'fk_'+sha(canonical.encode())[:40]

def expected_manifest_digest(files):
    lines = ['|'.join([f['fileKey'], f['contentSha256'], str(f['byteLength']), f['mimeType'],
                       '-' if f['claimedPages'] is None else str(f['claimedPages']), f['claimedBasis'] or '-'])
             for f in sorted(files, key=lambda f: f['fileKey'])]
    return 'sha256:' + sha('\n'.join(['tavonel-intake-manifest-v1', str(len(files)), *lines]).encode())

def expected_source_key(attempt_key, file_key):
    return sha(f'tavonel-approved-source-v1\x1f{attempt_key}\x1f{file_key}'.encode())

def quote_for(body):
    """A synthetic price: two credits per page, uncounted members at the 80-page ceiling."""
    files = []
    for entry in body['files']:
        pages = entry['claimedPages'] or 80
        files.append({'fileKey': entry['fileKey'], 'pageBasis': 'unknown' if entry['claimedPages'] is None else 'declared',
                      'approvedMaxPages': pages, 'reservedCredits': pages, 'maximumCredits': 2 * pages})
    reserved = sum(f['reservedCredits'] for f in files); maximum = sum(f['maximumCredits'] for f in files)
    return {'code': 'INTAKE_QUOTE', 'clientManifestDigest': body['clientManifestDigest'], 'pricingFingerprint': FINGERPRINT,
            'metadataLimitBytes': 32768, 'files': files,
            'quote': {'maximumPages': sum(f['approvedMaxPages'] for f in files), 'reservedCredits': reserved,
                      'maximumCredits': maximum, 'estimatedUsd': reserved / 100, 'maximumUsd': maximum / 100}}

def approval_for(body):
    quoted = {f['fileKey']: f for f in quote_for(body)['files']}
    files = [{'fileKey': e['fileKey'], 'documentId': str(uuid.uuid4()),
              'fileState': 'approved', 'contentSha256': e['contentSha256'], 'byteLength': e['byteLength'], 'mimeType': e['mimeType'],
              'pageBasis': quoted[e['fileKey']]['pageBasis'], 'approvedMaxPages': quoted[e['fileKey']]['approvedMaxPages'],
              'approvedReservedCredits': quoted[e['fileKey']]['reservedCredits'],
              'approvedMaximumCredits': quoted[e['fileKey']]['maximumCredits'],
              'reservationId': None, 'reservationState': None, 'reservationExpiresAt': None} for e in body['files']]
    return {'approvalId': str(uuid.uuid5(uuid.NAMESPACE_URL, body['attemptKey'])), 'attemptKey': body['attemptKey'],
            'clientManifestDigest': body['clientManifestDigest'], 'scopeDigest': 'sha256:' + sha(body['clientManifestDigest'].encode()),
            'pricingFingerprint': FINGERPRINT, 'state': 'approved', 'expiresAt': '2099-01-01T00:00:00Z', 'expired': False,
            'fileCount': len(files), 'aggregateMaximumPages': sum(f['approvedMaxPages'] for f in files),
            'aggregateReservedCredits': sum(f['approvedReservedCredits'] for f in files),
            'aggregateMaximumCredits': sum(f['approvedMaximumCredits'] for f in files),
            'compilable': False, 'idempotentReplay': False, 'files': files}

class Client:
    """Stands in for FoundationClient where the wire is not under test; WireTests use the real one."""
    bodies = []
    uploads = []
    approvals = {}
    lose_response = False
    def __init__(self, *args): pass
    def quote(self, body): return quote_for(body)
    def create_approval(self, body):
        Client.approvals.setdefault(body['attemptKey'], approval_for(body))
        return json.loads(json.dumps(Client.approvals[body['attemptKey']]))
    def read_approval(self, attempt_key):
        approval = Client.approvals.get(attempt_key)
        return None if approval is None else json.loads(json.dumps(approval))
    def upload(self, path, member, attempt, on_phase=None):
        self.uploads.append((member['originalFilename'], attempt['attemptKey']))
        for held in Client.approvals[attempt['attemptKey']]['files']:
            if held['fileKey'] == member['fileKey']: held['fileState'] = 'confirmed'
        return member['documentId']
    def post(self, path, body):
        self.bodies.append(body)
        if self.lose_response:
            Client.lose_response = False
            raise agent.RetryableAgentError('lost response')
        return {'status': 'replayed' if len(self.bodies) > 1 and self.bodies[-1]['batchId'] == self.bodies[-2]['batchId'] else 'applied'}

class SyncFixture:
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = canonical_temp_base(self.tmp)
        self.root = self.base / 'source-root'; self.root.mkdir()
        self.args = agent.parser().parse_args(['--root',str(self.root),'--connection-id',CONNECTION,'--state',str(self.base/'state.json'),
                                               '--approve-up-to-credits','100000','--allow-unknown-page-count'])
        Client.bodies=[]; Client.uploads=[]; Client.approvals={}; Client.lose_response=False
        self.fake = patch.object(agent,'FoundationClient',Client); self.fake.start()
    def tearDown(self):
        self.fake.stop(); self.tmp.cleanup()
    def add(self, name='a.pdf', data=b'example'):
        (self.root/name).write_bytes(data)

class SyncTests(SyncFixture, unittest.TestCase):
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
        try:(self.root/'linked.pdf').symlink_to(outside)
        except (OSError,NotImplementedError):self.skipTest('symlink creation is unavailable')
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

class PlanTests(SyncFixture, unittest.TestCase):
    """Intake-plan behavior on a host with a handle-anchored backend (Windows or Linux)."""
    def setUp(self):
        super().setUp()
        self.backend=traversal_backend(self)

    def test_plan_prunes_generated_and_credential_trees_without_opening_files(self):
        (self.root/'contracts').mkdir()
        (self.root/'contracts'/'old-v1.pdf').write_bytes(b'history')
        (self.root/'.aws').mkdir();(self.root/'.aws'/'credentials').write_bytes(b'not-read')
        (self.root/'node_modules'/'nested').mkdir(parents=True)
        (self.root/'node_modules'/'nested'/'evidence.pdf').write_bytes(b'not-read')
        (self.root/'.env').write_bytes(b'not-read')
        (self.root/'contracts'/'credentials.pdf').write_bytes(b'not-read')
        with patch.object(agent, 'file_digest', side_effect=AssertionError('content digest called')), \
             patch.object(Path, 'open', side_effect=AssertionError('file opened')):
            plan=agent.plan_mount(self.root)
        by_path={item['path']:item for item in plan['entries']}
        self.assertEqual(by_path['contracts/old-v1.pdf']['status'],'eligible')
        self.assertEqual(by_path['.aws']['status'],'excluded_by_policy')
        self.assertEqual(by_path['node_modules']['status'],'excluded_by_policy')
        self.assertEqual(by_path['.env']['status'],'excluded_by_policy')
        self.assertNotIn('node_modules/nested/evidence.pdf',by_path)
        self.assertNotIn('.aws/credentials',by_path)
        self.assertEqual(by_path['contracts/credentials.pdf']['status'],'excluded_by_policy')
        self.assertFalse(plan['contentInspected'])

    def test_plan_unsupported_and_oversized_files_never_abort_eligible_candidates(self):
        ceiling=agent.FOUNDATION_MAX_SOURCE_BYTES
        self.add('a.pdf',b'pdf')
        for name in ('huge.bin','huge.pdf'):
            with (self.root/name).open('wb') as handle: handle.truncate(ceiling*4+1)
        # A tiny candidate budget proves neither huge file is counted as a candidate byte.
        with patch.object(agent,'PLAN_POLICY',plan_policy(candidateBytes=16)): plan=agent.plan_mount(self.root)
        by_path={item['path']:item for item in plan['entries']}
        self.assertEqual(by_path['a.pdf']['status'],'eligible')
        self.assertEqual(by_path['huge.bin']['status'],'unsupported')
        self.assertEqual(by_path['huge.pdf']['status'],'oversized')
        self.assertIsNone(by_path['a.pdf']['pageCount']);self.assertIsNone(by_path['huge.pdf']['pageCount'])
        self.assertEqual(plan['candidateBytes'],3)
        self.assertEqual(plan['truncatedBy'],[])
        self.assertTrue(plan['scanComplete'])

    def test_plan_service_byte_ceiling_is_authoritative_and_page_count_stays_unknown(self):
        ceiling=agent.FOUNDATION_MAX_SOURCE_BYTES
        self.assertEqual(ceiling,5*1024*1024);self.assertEqual(ceiling,5_242_880)
        self.assertEqual(agent.FOUNDATION_MAX_SOURCE_PAGES,80)
        for name,size in (('exact.pdf',ceiling),('over.pdf',ceiling+1)):
            with (self.root/name).open('wb') as handle: handle.truncate(size)
        plan=agent.plan_mount(self.root)
        by_path={item['path']:item for item in plan['entries']}
        exact,over=by_path['exact.pdf'],by_path['over.pdf']
        self.assertEqual((exact['status'],exact['reason']),('eligible','within_service_byte_ceiling_only_page_count_unknown'))
        self.assertEqual(exact['sizeBytes'],ceiling)
        self.assertIsNone(exact['pageCount'])
        self.assertEqual(set(exact),{'path','status','reason','sizeBytes','mimeType','pageCount','modifiedNs'})
        # Handle-read metadata matches the file system's own size and modification time.
        self.assertEqual(exact['modifiedNs'],os.stat(self.root/'exact.pdf').st_mtime_ns)
        self.assertEqual((over['status'],over['reason']),('oversized','exceeds_service_byte_ceiling_needs_review'))
        self.assertEqual(over['sizeBytes'],ceiling+1)
        self.assertIsNone(over['pageCount'])
        self.assertEqual(plan['candidateBytes'],ceiling)
        self.assertTrue(plan['scanComplete'])
        self.assertFalse(plan['pageCountInspected']);self.assertFalse(plan['serviceAdmissionDetermined'])
        service=plan['policy']['serviceCeiling']
        self.assertEqual((service['maxSourceBytes'],service['maxSourcePages']),(5_242_880,80))
        self.assertEqual(service['pageCeilingCheck'],'disclosed_not_enforced_at_intake')
        self.assertEqual(service['authorityCommit'],'5347af4d5f76ba971927105b0a3d5cf20e13224e')
        self.assertEqual(service['authorityBlob'],'48d5a5ba040138011c69ce11df415035d8fc1e02')
        # Scan budgets are not service admission, and the invented 100 MiB per-file limit is gone.
        self.assertNotIn('fileBytes',plan['policy']['scanBudgets']);self.assertNotIn('limits',plan['policy'])
        self.assertNotIn('104857600',agent.canonical(plan))
        self.assertNotIn('admitted',agent.canonical(plan).lower())

    def test_plan_reports_handle_anchored_traversal(self):
        self.add('a.pdf',b'a')
        plan=agent.plan_mount(self.root)
        expected='windows_nt_relative_open_no_reparse' if os.name=='nt' else 'linux_openat_nofollow'
        self.assertEqual(plan['traversal'],{'mode':expected,'handleAnchored':True,'unsupportedReason':None})
        self.assertIsNone(plan['failClosedReason']);self.assertTrue(plan['scanComplete'])

    def test_plan_policy_and_budgets_are_unchanged_by_anchored_traversal(self):
        budgets=agent.PLAN_POLICY['scanBudgets']
        self.assertEqual(budgets,{'fileCount':5000,'candidateBytes':536870912,'elapsedSeconds':5.0,'manifestEntries':2000,'outputBytes':1048576})
        plan=agent.plan_mount(self.root)
        # Traversal is reported beside the policy, so the fingerprint still covers only the unchanged policy.
        self.assertNotIn('traversal',plan['policy'])
        self.assertEqual(plan['policyFingerprint'],agent.sha256(agent.canonical(json.loads(agent.canonical(agent.PLAN_POLICY)))))
        self.assertEqual(plan['schema'],'tavonel.source-intake-plan.v2')

    def test_plan_missing_root_is_inaccessible_and_redacts_absolute_path(self):
        missing=self.base/'private-customer-name'/'missing'
        plan=agent.plan_mount(missing)
        self.assertEqual(plan['entries'][0]['status'],'inaccessible')
        self.assertNotIn(str(missing),agent.canonical(plan))
        self.assertFalse(plan['scanComplete'])
        self.assertFalse(plan['partialScanFinalized'])
        output=[]
        args=agent.parser().parse_args(['--root',str(missing),'--dry-run-plan'])
        self.assertEqual(agent.run(args,emit=output.append),2)
        self.assertFalse(json.loads(output[0])['scanComplete'])
        not_a_directory=self.base/'file-root.pdf';not_a_directory.write_bytes(b'x')
        plan=agent.plan_mount(not_a_directory)
        self.assertEqual([(e['path'],e['status'],e['reason']) for e in plan['entries']],[('','inaccessible','root_unavailable')])
        self.assertFalse(plan['scanComplete'])

    def test_plan_symlink_escape_never_follows_target(self):
        with patch.object(self.backend,'children',listing([child('escape.pdf',link='symlink')])), \
             recorded_opens(self.backend) as opened:
            plan=agent.plan_mount(self.root)
        link=next(item for item in plan['entries'] if item['path']=='escape.pdf')
        self.assertEqual(link['status'],'needs_review')
        self.assertEqual(link['reason'],'symlink_not_followed')
        self.assertNotIn('escape.pdf',opened)
        self.assertNotIn(str(self.base),agent.canonical(plan))

    def test_plan_symlink_root_is_never_followed(self):
        refuse=lambda name:(None,'symlink') if name==self.root.name else None
        with recorded_opens(self.backend,refuse), \
             patch.object(self.backend,'children',side_effect=AssertionError('symlink root listed')):
            plan=agent.plan_mount(self.root)
        self.assertEqual(plan['entries'][0]['status'],'needs_review')
        self.assertEqual(plan['entries'][0]['reason'],'root_symlink_not_followed')
        self.assertFalse(plan['scanComplete'])

    def test_plan_simulated_junction_root_and_child_are_never_followed(self):
        # The open of the root's own name reports a reparse point; real junctions are tested below.
        refuse=lambda name:(None,'reparse_point') if name==self.root.name else None
        with recorded_opens(self.backend,refuse), \
             patch.object(self.backend,'children',side_effect=AssertionError('junction root listed')):
            rooted=agent.plan_mount(self.root)
        self.assertEqual([(e['path'],e['status'],e['reason']) for e in rooted['entries']],[('','needs_review','root_reparse_point_not_followed')])
        self.assertFalse(rooted['scanComplete'])
        listed=[]
        with patch.object(self.backend,'children',listing([child('escape',link='reparse_point',is_dir=True)],listed)), \
             recorded_opens(self.backend) as opened:
            plan=agent.plan_mount(self.root)
        escape=next(item for item in plan['entries'] if item['path']=='escape')
        self.assertEqual((escape['status'],escape['reason']),('needs_review','reparse_point_not_followed'))
        self.assertNotIn('escape',opened)
        self.assertEqual(len(listed),1)

    def test_plan_policy_change_changes_policy_fingerprint(self):
        first=agent.plan_mount(self.root)
        policy=json.loads(agent.canonical(agent.PLAN_POLICY));policy['excludeDirectoryNames'].append('contracts')
        with patch.object(agent,'PLAN_POLICY',policy):second=agent.plan_mount(self.root)
        self.assertNotEqual(first['policyFingerprint'],second['policyFingerprint'])
        self.assertEqual(first['rootFingerprint'],second['rootFingerprint'])

    def test_plan_budget_truncation_never_finalizes_absence(self):
        # fileCount=1 must visit, stat and report exactly one entry; the draft reported two.
        self.add('a.pdf',b'a');self.add('b.pdf',b'b')
        (self.root/'sub').mkdir();(self.root/'sub'/'c.pdf').write_bytes(b'c')
        stats=[]
        def counted(iterator):
            for entry in iterator:
                def metadata(entry=entry):
                    stats.append(entry.name);return entry.metadata()
                yield agent._Child(entry.name,metadata)
        with patch.object(agent,'PLAN_POLICY',plan_policy(fileCount=1)), patched_children(self.backend,transform=counted):
            plan=agent.plan_mount(self.root)
        self.assertEqual(plan['visitedEntries'],1)
        self.assertEqual(len(plan['entries']),1)
        self.assertEqual(sum(plan['counts'].values()),1)
        self.assertEqual(len(stats),1)
        self.assertEqual(plan['truncatedBy'],['file_count'])
        self.assertFalse(plan['scanComplete'])
        self.assertFalse(plan['partialScanFinalized'])
        self.assertEqual(plan['absenceSemantics'],'none')
        # A budget that fits exactly learns of no further work and stays complete.
        exact=self.base/'exact';exact.mkdir();(exact/'a.pdf').write_bytes(b'a');(exact/'b.pdf').write_bytes(b'b')
        with patch.object(agent,'PLAN_POLICY',plan_policy(fileCount=2)):fitting=agent.plan_mount(exact)
        self.assertEqual((fitting['visitedEntries'],fitting['truncatedBy'],fitting['scanComplete']),(2,[],True))

    def test_plan_case_only_names_keep_one_manifest_under_reversed_enumeration(self):
        # A default (case-insensitive) NTFS directory can't hold A.pdf and a.pdf, so the listing is synthetic.
        entries=[child('A.pdf',size=1),child('a.pdf',size=2)]
        plans=[]
        for order in (entries,entries[::-1]):
            with patch.object(self.backend,'children',listing(order)):plans.append(agent.plan_mount(self.root))
        first,second=plans
        self.assertEqual([(e['path'],e['sizeBytes']) for e in first['entries']],[('A.pdf',1),('a.pdf',2)])
        self.assertEqual(first['entries'],second['entries'])
        self.assertEqual(first['manifestSha256'],second['manifestSha256'])

    def test_plan_case_only_directories_open_by_exact_name_only_where_lookup_is_exact(self):
        tree={'A':[child('upper.pdf',size=1)],'a':[child('lower.pdf',size=2)]}
        real_close=self.backend.close
        @contextmanager
        def children(backend,handle):
            # The real root lists case-only sibling directories; each fake child handle lists its own file.
            yield iter(tree[handle[1]] if isinstance(handle,tuple) else [child('A',is_dir=True),child('a',is_dir=True)])
        def close(backend,handle):
            if not isinstance(handle,tuple):real_close(backend,handle)
        def plan(exact):
            queries=[]
            def exact_lookup(backend,handle):
                queries.append(handle);return exact
            hook=lambda name:(('fake',name),None) if name in tree else None
            with patch.object(self.backend,'children',children), patch.object(self.backend,'close',close), \
                 patch.object(self.backend,'exact_lookup',exact_lookup), recorded_opens(self.backend,hook) as opened:
                return agent.plan_mount(self.root),opened,queries
        # A directory known to look names up exactly: each exact name is opened separately.
        result,opened,queries=plan(True)
        self.assertEqual(opened[-2:],['A','a']);self.assertEqual(len(queries),1)
        self.assertEqual([(e['path'],e['status'],e['sizeBytes']) for e in result['entries']],[('a/lower.pdf','eligible',2),('A/upper.pdf','eligible',1)])
        self.assertIsNone(result['failClosedReason']);self.assertTrue(result['scanComplete'])
        # Unflagged or unknown case policy: neither name is opened, and the plan never claims completeness.
        result,opened,queries=plan(False)
        self.assertNotIn('A',opened);self.assertNotIn('a',opened);self.assertEqual(len(queries),1)
        self.assertEqual([(e['path'],e['status'],e['reason']) for e in result['entries']],
                         [('A','needs_review','case_ambiguous_directory_not_traversed'),('a','needs_review','case_ambiguous_directory_not_traversed')])
        self.assertEqual(result['failClosedReason'],'case_ambiguous_lookup')
        self.assertFalse(result['scanComplete']);self.assertFalse(result['partialScanFinalized'])
        self.assertEqual(result['absenceSemantics'],'none');self.assertNotIn('.pdf',agent.canonical(result['entries']))
        # Without a case-only collision the policy is never queried.
        (self.root/'sub').mkdir();(self.root/'sub'/'b.pdf').write_bytes(b'b')
        with patch.object(self.backend,'exact_lookup',side_effect=AssertionError('case policy queried without a collision')):
            self.assertTrue(agent.plan_mount(self.root)['scanComplete'])

    def test_plan_native_case_sensitive_directory_keeps_case_only_subtrees_apart(self):
        # Detected read-only from a fixture this test creates; case sensitivity is never set or changed.
        (self.root/'Probe').mkdir()
        if (self.root/'probe').exists():
            self.skipTest('the temporary directory is case-insensitive, and this suite never enables case sensitivity')
        for name,data in (('A',b'upper'),('a',b'lower!')):
            (self.root/name).mkdir();(self.root/name/f'{name}-only.pdf').write_bytes(data)
        plan=agent.plan_mount(self.root)
        self.assertEqual([(e['path'],e['status'],e['sizeBytes']) for e in plan['entries']],[('A/A-only.pdf','eligible',5),('a/a-only.pdf','eligible',6)])
        self.assertIsNone(plan['failClosedReason']);self.assertTrue(plan['scanComplete'])

    def test_plan_traversal_is_independent_of_enumeration_order(self):
        (self.root/'Docs').mkdir();(self.root/'Docs'/'b.PDF').write_bytes(b'b')
        (self.root/'docs-archive').mkdir();(self.root/'docs-archive'/'c.pdf').write_bytes(b'c')
        self.add('Z.pdf',b'z');self.add('y.pdf',b'y')
        forward=agent.plan_mount(self.root)
        with patched_children(self.backend,transform=lambda iterator:iter(list(iterator)[::-1])):backward=agent.plan_mount(self.root)
        self.assertEqual([e['path'] for e in forward['entries']],['docs-archive/c.pdf','Docs/b.PDF','y.pdf','Z.pdf'])
        self.assertEqual(forward['entries'],backward['entries'])
        self.assertEqual(forward['manifestSha256'],backward['manifestSha256'])

    def test_plan_candidate_byte_budget_truncates_without_finalizing_absence(self):
        self.add('a.pdf',b'aaa');self.add('b.pdf',b'bbb')
        with patch.object(agent,'PLAN_POLICY',plan_policy(candidateBytes=4)):plan=agent.plan_mount(self.root)
        by_path={item['path']:item for item in plan['entries']}
        self.assertEqual(by_path['a.pdf']['status'],'eligible')
        self.assertEqual((by_path['b.pdf']['status'],by_path['b.pdf']['reason']),('needs_review','candidate_byte_budget_exceeded'))
        self.assertIsNone(by_path['b.pdf']['pageCount'])
        self.assertEqual(plan['candidateBytes'],3)
        self.assertEqual(plan['truncatedBy'],['candidate_bytes'])
        self.assertFalse(plan['scanComplete']);self.assertFalse(plan['partialScanFinalized'])
        self.assertEqual(plan['absenceSemantics'],'none')

    def test_plan_elapsed_budget_stops_between_directories(self):
        self.add('a.pdf',b'a');(self.root/'sub').mkdir();(self.root/'sub'/'b.pdf').write_bytes(b'b')
        now=[0.0]
        def before(call):
            if call==2:now[0]=10.0
        with patched_children(self.backend,before=before):plan=agent.plan_mount(self.root,clock=lambda:now[0])
        by_path={item['path']:item for item in plan['entries']}
        self.assertEqual(by_path['a.pdf']['status'],'eligible')
        self.assertNotIn('sub/b.pdf',by_path)
        self.assertEqual(plan['truncatedBy'],['elapsed_time'])
        self.assertFalse(plan['scanComplete']);self.assertFalse(plan['partialScanFinalized'])
        self.assertEqual(plan['absenceSemantics'],'none')

    def test_plan_manifest_is_deterministic_and_never_claims_exact_reuse(self):
        (self.root/'versions').mkdir()
        (self.root/'versions'/'report-v1.pdf').write_bytes(b'fixture')
        first=agent.plan_mount(self.root);second=agent.plan_mount(self.root)
        self.assertEqual(first['entries'],second['entries'])
        self.assertEqual(first['manifestSha256'],second['manifestSha256'])
        self.assertFalse(first['unchangedContentClaimed'])
        self.assertIn('unchanged_metadata_candidate',first['statusVocabulary'])
        self.assertEqual(first['entries'][0]['status'],'eligible')

    def test_plan_cli_has_no_network_credentials_or_state_mutation(self):
        state=self.base/'unused-state.json';out=[]
        with self.assertRaises(SystemExit):
            agent.parser().parse_args(['--root',str(self.root)])
        args=agent.parser().parse_args(['--root',str(self.root),'--dry-run-plan'])
        forbidden=AssertionError('dry-run called network/auth/sync path')
        with patch.object(agent,'FoundationClient',side_effect=forbidden), \
             patch.object(agent,'sync',side_effect=forbidden), \
             patch.object(agent,'s3_client',side_effect=forbidden), \
             patch.object(agent,'read_state',side_effect=forbidden), \
             patch.object(agent,'write_state',side_effect=forbidden), \
             patch.object(agent,'write_journal',side_effect=forbidden), \
             patch.object(agent.urllib.request,'build_opener',side_effect=forbidden), \
             patch.object(agent.urllib.request,'urlopen',side_effect=forbidden), \
             patch('socket.socket',side_effect=forbidden), \
             patch.dict(os.environ,{'TAVONEL_API_KEY':'tvnl_live_synthetic_fixture'}):
            self.assertEqual(agent.run(args,emit=out.append),0)
        plan=json.loads(out[0])
        self.assertEqual(plan['schema'],agent.PLAN_SCHEMA)
        self.assertNotIn('tvnl_live_synthetic_fixture',out[0])
        self.assertFalse(state.exists())
        self.assertFalse(state.with_name(state.name+'.pending').exists())

    def test_plan_never_opens_reads_writes_or_deletes(self):
        self.add('a.pdf',b'not-read');(self.root/'sub').mkdir();(self.root/'sub'/'b.docx').write_bytes(b'not-read')
        def tree():return sorted((path.relative_to(self.base).as_posix(),path.stat().st_size) for path in self.base.rglob('*'))
        before=tree()
        forbidden=AssertionError('plan opened, hashed, wrote or deleted something')
        real_open=os.open;directory_opens=[]
        def directory_only_open(path,flags,*args,**kwargs):
            # Linux opens directories by descriptor; nothing else may be opened. Windows never calls os.open.
            if os.name=='nt' or not flags&os.O_DIRECTORY or not flags&os.O_NOFOLLOW or flags&(os.O_WRONLY|os.O_RDWR):
                raise forbidden
            directory_opens.append(path);return real_open(path,flags,*args,**kwargs)
        with patch('builtins.open',side_effect=forbidden), \
             patch.object(agent.os,'open',directory_only_open), \
             patch.object(agent.os,'remove',side_effect=forbidden), \
             patch.object(agent.os,'unlink',side_effect=forbidden), \
             patch.object(agent.os,'rmdir',side_effect=forbidden), \
             patch.object(agent.os,'rename',side_effect=forbidden), \
             patch.object(agent.os,'replace',side_effect=forbidden), \
             patch.object(agent.os,'chmod',side_effect=forbidden), \
             patch.object(Path,'open',side_effect=forbidden), \
             patch.object(agent,'file_digest',side_effect=forbidden), \
             patch.object(agent,'snapshot_mount',side_effect=forbidden):
            plan=agent.plan_mount(self.root)
        self.assertEqual(before,tree())
        self.assertEqual({item['path']:item['status'] for item in plan['entries']},{'a.pdf':'eligible','sub/b.docx':'eligible'})
        self.assertFalse(plan['contentInspected']);self.assertTrue(plan['scanComplete'])
        self.assertNotIn('a.pdf',directory_opens);self.assertNotIn('b.docx',directory_opens)

    def test_plan_never_lists_or_resolves_by_path(self):
        (self.root/'sub').mkdir();(self.root/'sub'/'b.pdf').write_bytes(b'b')
        real_scandir=os.scandir;path_listings=[]
        def scandir(target):
            if os.name=='nt' or not isinstance(target,int):path_listings.append(target)
            return real_scandir(target)
        forbidden=AssertionError('path-based lookup during the plan')
        with patch.object(agent.os,'scandir',scandir), \
             patch.object(agent.os,'lstat',side_effect=forbidden), \
             patch.object(agent.os,'listdir',side_effect=forbidden), \
             patch.object(agent.os,'walk',side_effect=forbidden), \
             patch.object(agent.os.path,'realpath',side_effect=forbidden):
            plan=agent.plan_mount(self.root)
        self.assertEqual(path_listings,[])
        self.assertEqual([(e['path'],e['status']) for e in plan['entries']],[('sub/b.pdf','eligible')])
        self.assertTrue(plan['scanComplete'])

    @unittest.skipUnless(os.name=='nt','NT handle-relative opens exist only on Windows')
    def test_windows_every_open_is_one_name_beneath_a_held_handle(self):
        (self.root/'sub').mkdir();(self.root/'sub'/'b.pdf').write_bytes(b'b')
        real=agent._WindowsTraversal._nt_open;calls=[]
        def recording(backend,parent,name,access):
            calls.append((parent,name));return real(backend,parent,name,access)
        with patch.object(agent._WindowsTraversal,'_nt_open',recording):plan=agent.plan_mount(self.root)
        self.assertTrue(plan['scanComplete'])
        _,rest=os.path.splitdrive(str(self.root))
        self.assertEqual([name for _,name in calls],[part for part in rest.split('\\') if part]+['sub'])
        for parent,name in calls:
            self.assertTrue(parent)  # always relative to an already-open directory handle
            self.assertNotIn('\\',name);self.assertNotIn('/',name);self.assertNotIn(':',name)
        self.assertTrue(agent._NT_DIRECTORY_OPEN_OPTIONS & agent._FILE_OPEN_REPARSE_POINT)
        self.assertTrue(agent._NT_DIRECTORY_OPEN_OPTIONS & agent._FILE_DIRECTORY_FILE)

    @unittest.skipUnless(ON_LINUX,'descriptor-relative opens are checked on Linux')
    def test_linux_every_open_is_a_nofollow_directory_beneath_a_held_descriptor(self):
        (self.root/'sub').mkdir();(self.root/'sub'/'b.pdf').write_bytes(b'b')
        real_open=os.open;calls=[]
        def recording(path,flags,*args,**kwargs):
            calls.append((path,flags,kwargs.get('dir_fd')));return real_open(path,flags,*args,**kwargs)
        with patch.object(agent.os,'open',recording):plan=agent.plan_mount(self.root)
        self.assertTrue(plan['scanComplete'])
        self.assertEqual((calls[0][0],calls[0][2]),('/',None))
        for path,flags,dir_fd in calls:
            self.assertTrue(flags&os.O_DIRECTORY and flags&os.O_NOFOLLOW)
        for path,flags,dir_fd in calls[1:]:
            self.assertIsInstance(dir_fd,int);self.assertNotIn('/',path)
        self.assertEqual([path for path,_,_ in calls[1:]],[part for part in str(self.root).split('/') if part]+['sub'])

    def test_plan_unsupported_filesystem_fails_closed_before_listing(self):
        self.add('a.pdf',b'a')
        allowlist='SUPPORTED_FILESYSTEMS' if os.name=='nt' else 'LOCAL_FILESYSTEMS'
        with patch.object(self.backend,allowlist,frozenset()), patched_children(self.backend) as calls:
            plan=agent.plan_mount(self.root)
            out=[];code=agent.run(agent.parser().parse_args(['--root',str(self.root),'--dry-run-plan']),emit=out.append)
        self.assertEqual(calls,[])
        assert_fails_closed_unsupported(self,plan,'filesystem_not_supported')
        self.assertEqual(code,2);self.assertNotIn('a.pdf',out[0])

    def test_plan_output_is_bounded_and_inaccessible_root_is_fail_closed(self):
        for index in range(100):self.add(f'{index:03}.pdf',b'a')
        with patch.object(agent,'PLAN_POLICY',plan_policy(outputBytes=8192)):plan=agent.plan_mount(self.root)
        self.assertLessEqual(len(agent.canonical(plan).encode('utf-8'))+1,8192)
        self.assertIn('output_bytes',plan['truncatedBy'])
        self.assertFalse(plan['scanComplete']);self.assertFalse(plan['partialScanFinalized'])
        self.assertEqual(plan['absenceSemantics'],'none')
        self.assertEqual(plan['entries'][0]['path'],'000.pdf')
        self.assertEqual(sum(plan['counts'].values()),len(plan['entries']))
        self.assertEqual(plan['manifestSha256'],'sha256:'+agent.sha256(agent.canonical(plan['entries'])))

    def test_plan_unreadable_root_and_elapsed_budget_are_partial(self):
        with patch.object(self.backend,'children',side_effect=PermissionError('fixture')):
            inaccessible=agent.plan_mount(self.root)
        self.assertEqual((inaccessible['entries'][0]['status'],inaccessible['entries'][0]['reason']),('inaccessible','directory_unreadable'))
        self.assertFalse(inaccessible['scanComplete'])
        self.add('a.pdf',b'a')
        ticks=iter([0.0]+[10.0]*100)
        elapsed=agent.plan_mount(self.root,clock=lambda:next(ticks))
        self.assertEqual(elapsed['truncatedBy'],['elapsed_time'])
        self.assertEqual([(e['path'],e['status'],e['reason']) for e in elapsed['entries']],[('','needs_review','directory_not_traversed_scan_incomplete')])
        self.assertFalse(elapsed['partialScanFinalized'])

    def test_plan_leaves_normal_sync_behavior_unchanged(self):
        self.add(data=b'example')
        args=agent.parser().parse_args(['--root',str(self.root),'--dry-run-plan'])
        self.assertEqual(agent.run(args,emit=lambda line:None),0)
        self.assertFalse(self.args.state.exists());self.assertEqual(Client.bodies,[]);self.assertEqual(Client.uploads,[])
        self.assertEqual(agent.sync(self.args)['status'],'applied')
        self.assertEqual(agent.sync(self.args)['status'],'unchanged')
        self.assertEqual(len(Client.uploads),1);self.assertEqual(len(Client.bodies),1)
        self.assertEqual(Client.bodies[0]['events'][0]['nativeId'],'a.pdf')

def assert_fails_closed_unsupported(test,plan,reason):
    test.assertEqual([(e['path'],e['status'],e['reason']) for e in plan['entries']],[('','needs_review','unsupported_safe_traversal')])
    test.assertEqual(plan['failClosedReason'],'unsupported_safe_traversal')
    test.assertEqual(plan['traversal']['unsupportedReason'],reason)
    test.assertFalse(plan['traversal']['handleAnchored'])
    test.assertFalse(plan['scanComplete']);test.assertFalse(plan['partialScanFinalized'])
    test.assertEqual(plan['absenceSemantics'],'none')
    test.assertEqual((plan['candidateBytes'],plan['visitedEntries']),(0,0))
    test.assertNotIn('.pdf',agent.canonical(plan['entries']))

class UnsupportedTraversalTests(SyncFixture, unittest.TestCase):
    """Fail closed before any listing wherever handle-anchored traversal can't be established."""
    def test_unsupported_traversal_fails_closed_without_path_fallback(self):
        self.add('a.pdf',b'a')
        forbidden=AssertionError('listed without an anchored handle')
        with patch.object(agent,'_traversal_backend',side_effect=agent.UnsupportedSafeTraversal('platform_not_supported')), \
             patch.object(agent.os,'scandir',side_effect=forbidden), \
             patch.object(agent.os,'listdir',side_effect=forbidden), \
             patch.object(agent.os,'walk',side_effect=forbidden), \
             patch.object(agent.os,'lstat',side_effect=forbidden):
            plan=agent.plan_mount(self.root)
            out=[];code=agent.run(agent.parser().parse_args(['--root',str(self.root),'--dry-run-plan']),emit=out.append)
        assert_fails_closed_unsupported(self,plan,'platform_not_supported')
        self.assertEqual(code,2);self.assertEqual(json.loads(out[0])['failClosedReason'],'unsupported_safe_traversal')

    def test_platforms_without_a_backend_fail_closed(self):
        if os.name=='nt' or ON_LINUX:self.skipTest('this platform has a handle-anchored backend')
        self.add('a.pdf',b'a')
        plan=agent.plan_mount(self.root)
        self.assertEqual(plan['failClosedReason'],'unsupported_safe_traversal')
        self.assertNotIn('a.pdf',agent.canonical(plan['entries']));self.assertFalse(plan['scanComplete'])

    @unittest.skipUnless(os.name=='nt','UNC paths are a Windows concept')
    def test_windows_network_path_fails_closed_before_any_open(self):
        # Rejected lexically before CreateFileW, so no name is resolved and nothing reaches the network.
        with patch.object(agent._WindowsTraversal,'_require_supported_volume',side_effect=AssertionError('volume opened')), \
             recorded_opens(agent._WindowsTraversal) as opened:
            plan=agent.plan_mount(Path('\\\\tavonel-fixture.invalid\\share\\documents'))
        self.assertEqual(opened,[])
        assert_fails_closed_unsupported(self,plan,'path_not_on_local_drive_letter')

class WindowsDirectoryEntryTests(unittest.TestCase):
    """Synthetic FILE_FULL_DIR_INFO records parsed by _WindowsTraversal._list; runs on any host."""
    def listed_link(self,attributes,ea_size):
        name='escape'.encode('utf-16-le')
        raw=agent._FULL_DIR_INFO.pack(0,0,0,0,agent._FILETIME_UNIX_EPOCH,0,0,0,attributes,len(name),ea_size)+name
        reads=[]
        def info_by_handle(handle,information_class,buffer,length):
            reads.append(information_class);agent.ctypes.memmove(buffer,raw,len(raw));return True
        backend=object.__new__(agent._WindowsTraversal);backend._info_by_handle=info_by_handle
        entry=next(backend._list(7))
        self.assertEqual((entry.name,reads),('escape',[agent._FILE_FULL_DIRECTORY_RESTART_INFO]))
        return entry.metadata().link

    def test_ea_size_is_never_read_as_a_reparse_tag(self):
        reparse_dir=agent._FILE_ATTRIBUTE_DIRECTORY|agent._FILE_ATTRIBUTE_REPARSE_POINT
        # EaSize is the extended-attributes length; even the symlink tag's value can't make a symlink.
        for ea_size in (agent._IO_REPARSE_TAG_SYMLINK,IO_REPARSE_TAG_MOUNT_POINT,0,123):
            self.assertEqual(self.listed_link(reparse_dir,ea_size),'reparse_point')
            self.assertIsNone(self.listed_link(agent._FILE_ATTRIBUTE_DIRECTORY,ea_size))

@unittest.skipUnless(os.name=='nt','NtCreateFile and per-directory case sensitivity exist only on Windows')
class WindowsCaseLookupTests(unittest.TestCase):
    """The native lookup boundary; no test sets or changes a directory's case sensitivity."""
    def test_case_only_siblings_are_opened_by_exact_name_without_forced_case_insensitivity(self):
        backend=agent._WindowsTraversal();captured=[];handles=iter([101,102])
        def nt_create_file(handle,access,attributes,status_block,allocation,file_attributes,share,disposition,options,ea,ea_length):
            value=attributes._obj;name=value.ObjectName.contents
            captured.append((value.RootDirectory,value.Attributes,agent.ctypes.wstring_at(name.Buffer,name.Length//2),name.Length,disposition,options))
            handle._obj.value=next(handles);return 0
        backend._nt_create_file=nt_create_file
        with patch.object(backend,'_attributes',return_value=(agent._FILE_ATTRIBUTE_DIRECTORY,0)):
            opened=[backend.open_beneath(7,name,listing=True) for name in ('A','a')]
        self.assertEqual(opened,[(101,None),(102,None)])
        # Each case-only sibling is passed separately, by its exact name, relative to the held parent.
        self.assertEqual([(root,name,length) for root,_,name,length,_,_ in captured],[(7,'A',2),(7,'a',2)])
        for _,attributes,_,_,disposition,options in captured:
            self.assertFalse(attributes&agent._OBJ_CASE_INSENSITIVE)
            self.assertEqual((disposition,options),(agent._FILE_OPEN,agent._NT_DIRECTORY_OPEN_OPTIONS))
            self.assertTrue(options&agent._FILE_OPEN_REPARSE_POINT)

    def test_case_policy_is_read_from_the_held_handle(self):
        tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup)
        root=canonical_temp_base(tmp)/'documents';root.mkdir();(root/'Probe').mkdir()
        # Read-only detection from this test's own fixture; the flag itself is never set.
        case_sensitive=not (root/'probe').exists()
        backend=agent._WindowsTraversal();handle=backend.open_root(str(root))
        try:self.assertEqual(backend.exact_lookup(handle),case_sensitive)
        finally:backend.close(handle)

class LinkConfinementTests(unittest.TestCase):
    """Real junctions on Windows (symlinks elsewhere); every target stays inside the temporary fixture."""
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.base=canonical_temp_base(self.tmp)
        self.root=self.base/'documents';self.root.mkdir()
        (self.root/'inside.pdf').write_bytes(b'inside')
        self.outside=self.base/'outside-private';self.outside.mkdir()
        (self.outside/'outside-secret.pdf').write_bytes(b'outside')
        # Probe once so a platform without link support skips here instead of failing mid-scan.
        self.kind=make_directory_link(self,self.base/'probe-link',self.outside)
        self.backend=traversal_backend(self)
    def tearDown(self):
        # shutil.rmtree removes junctions and symlinks without recursing into their targets.
        self.tmp.cleanup()

    def swap_to_link(self,directory,target=None):
        """Move a real directory away and put a link to an outside tree at its name, as a racing writer could."""
        moved=directory.with_name(directory.name+'-moved')
        try:rename_with_retry(directory,moved)
        except OSError as error:raise AssertionError(f'fixture could not move {directory.name}: {error}') from error
        make_directory_link(self,directory,target or self.outside)
        return moved

    def restore(self,directory,moved):
        remove_link(directory);rename_with_retry(moved,directory)

    def assert_never_escaped(self,plan):
        self.assertNotIn('outside-secret',agent.canonical(plan))
        self.assertFalse(plan['partialScanFinalized']);self.assertEqual(plan['absenceSemantics'],'none')
        self.assertTrue(plan['traversal']['handleAnchored'])
        self.assertNotIn('deleted',agent.canonical(plan['entries']))

    def nested_fixture(self):
        """root = <base>/ancestor/documents, plus an outside tree whose same-named child holds the secret."""
        ancestor=self.base/'ancestor';nested=ancestor/'documents';nested.mkdir(parents=True)
        (nested/'inside.pdf').write_bytes(b'inside')
        decoy=self.base/'outside-tree';(decoy/'documents').mkdir(parents=True)
        (decoy/'documents'/'outside-secret.pdf').write_bytes(b'outside')
        return ancestor,nested,decoy

    def test_root_link_is_rejected_without_listing_its_target(self):
        link=self.base/'documents-link'
        kind=make_directory_link(self,link,self.outside)
        if os.name=='nt' and hasattr(link,'is_junction'):
            # The bypass of the Codex draft: a junction is neither a symlink nor S_ISLNK.
            self.assertTrue(link.is_junction());self.assertFalse(link.is_symlink())
            self.assertFalse(stat.S_ISLNK(os.lstat(link).st_mode))
        with patched_children(self.backend) as calls:plan=agent.plan_mount(link)
        self.assertEqual(calls,[])
        self.assertEqual([(e['path'],e['status'],e['reason']) for e in plan['entries']],[('','needs_review',f'root_{kind}_not_followed')])
        self.assertNotIn('outside-secret',agent.canonical(plan))
        self.assertFalse(plan['scanComplete']);self.assertEqual(plan['absenceSemantics'],'none')
        out=[]
        args=agent.parser().parse_args(['--root',str(link),'--dry-run-plan'])
        self.assertEqual(agent.run(args,emit=out.append),2)
        self.assertNotIn('outside-secret',out[0])

    def test_queued_child_links_are_reported_and_never_opened(self):
        kind=make_directory_link(self,self.root/'escape',self.outside)
        (self.root/'nested').mkdir()
        make_directory_link(self,self.root/'nested'/'deeper-escape',self.outside)
        with patched_children(self.backend) as calls, recorded_opens(self.backend) as opened:
            plan=agent.plan_mount(self.root)
        by_path={item['path']:item for item in plan['entries']}
        for path in ('escape','nested/deeper-escape'):
            self.assertEqual((by_path[path]['status'],by_path[path]['reason']),('needs_review',f'{kind}_not_followed'))
        self.assertEqual(by_path['inside.pdf']['status'],'eligible')
        self.assertNotIn('outside-secret',agent.canonical(plan))
        self.assertNotIn('escape',opened);self.assertNotIn('deeper-escape',opened)
        self.assertEqual(len(calls),2)  # the root and nested, never a link
        self.assertIsNone(plan['failClosedReason']);self.assertTrue(plan['scanComplete'])

    def test_reviewer_transient_root_swap_lists_only_the_held_root(self):
        """Adapted from the preserved reviewer reproducer (reviewed-swap-away-back.py, left unmodified).

        While the root is being listed, the real root is renamed away, a junction to the
        outside tree takes its name, and the original is restored before the plan returns.
        r1 emitted outside-secret.pdf here with scanComplete=true. The reviewer's hook wrapped
        os.scandir(path), which r2 never calls, so the swap is staged at the handle listing.
        """
        events=[]
        def before(call):
            if call!=1:return
            moved=self.swap_to_link(self.root)
            # The pathname now leads outside: a path-based lister would see the secret here.
            self.assertIn('outside-secret.pdf',os.listdir(self.root))
            events.append(('swapped',moved))
        def after(call):
            if call==1 and events:
                self.restore(self.root,events[0][1]);events.append(('restored',None))
        with patched_children(self.backend,before=before,after=after) as calls:
            plan=agent.plan_mount(self.root)
        self.assertEqual([event for event,_ in events],['swapped','restored'])
        self.assertEqual(len(calls),1)
        self.assert_never_escaped(plan)
        self.assertEqual([(e['path'],e['status']) for e in plan['entries']],[('inside.pdf','eligible')])
        # The listing stayed on the directory object that was opened, so the plan is truthful and complete.
        self.assertIsNone(plan['failClosedReason']);self.assertTrue(plan['scanComplete'])
        self.assertTrue(self.root.is_dir());self.assertIn('inside.pdf',os.listdir(self.root))

    def test_root_replaced_during_listing_stays_anchored(self):
        (self.root/'sub').mkdir();(self.root/'sub'/'x.pdf').write_bytes(b'x')
        swapped=[]
        def before(call):
            if call==1:swapped.append(self.swap_to_link(self.root))
        with patched_children(self.backend,before=before) as calls:plan=agent.plan_mount(self.root)
        self.assertTrue(swapped);self.assertEqual(len(calls),2)
        self.assert_never_escaped(plan)
        self.assertEqual([(e['path'],e['status']) for e in plan['entries']],[('inside.pdf','eligible'),('sub/x.pdf','eligible')])
        self.assertIsNone(plan['failClosedReason']);self.assertTrue(plan['scanComplete'])
        # The replacement stays in place, so the next plan refuses the link at the root.
        again=agent.plan_mount(self.root)
        self.assertEqual([(e['path'],e['status'],e['reason']) for e in again['entries']],[('','needs_review',f'root_{self.kind}_not_followed')])
        self.assertNotIn('outside-secret',agent.canonical(again));self.assertFalse(again['scanComplete'])

    def test_queued_child_replaced_before_traversal_fails_closed(self):
        first=self.root/'a-first';first.mkdir();(first/'a.pdf').write_bytes(b'a')
        later=self.root/'b-later';later.mkdir();(later/'b.pdf').write_bytes(b'b')
        swapped=[]
        # Lexical traversal lists the root, then a-first; b-later is replaced after it was queued.
        def before(call):
            if call==2:swapped.append(self.swap_to_link(later))
        with patched_children(self.backend,before=before) as calls, recorded_opens(self.backend) as opened:
            plan=agent.plan_mount(self.root)
        self.assertTrue(swapped);self.assertEqual(len(calls),2);self.assertIn('b-later',opened)
        self.assert_never_escaped(plan)
        self.assertEqual(plan['failClosedReason'],'directory_changed_before_traversal')
        by_path={item['path']:item for item in plan['entries']}
        self.assertEqual(by_path['a-first/a.pdf']['status'],'eligible')
        self.assertEqual((by_path['b-later']['status'],by_path['b-later']['reason']),('needs_review','directory_changed_not_followed'))
        self.assertNotIn('b-later/b.pdf',by_path)
        self.assertFalse(plan['scanComplete'])

    def test_directory_replaced_during_its_own_listing_stays_anchored(self):
        sub=self.root/'sub';sub.mkdir();(sub/'inside-sub.pdf').write_bytes(b'x')
        swapped=[]
        # sub's handle is already open when its name is moved away and replaced by a link.
        def before(call):
            if call==2:swapped.append(self.swap_to_link(sub))
        with patched_children(self.backend,before=before) as calls:plan=agent.plan_mount(self.root)
        self.assertTrue(swapped);self.assertEqual(len(calls),2)
        self.assert_never_escaped(plan)
        by_path={item['path']:item for item in plan['entries']}
        self.assertEqual(by_path['sub/inside-sub.pdf']['status'],'eligible')
        self.assertIsNone(plan['failClosedReason']);self.assertTrue(plan['scanComplete'])

    def test_ancestor_link_is_refused_before_listing(self):
        ancestor,nested,decoy=self.nested_fixture()
        self.swap_to_link(ancestor,decoy)
        self.assertIn('outside-secret.pdf',os.listdir(nested))  # the pathname now leads outside
        with patched_children(self.backend) as calls:plan=agent.plan_mount(nested)
        self.assertEqual(calls,[])
        self.assertEqual([(e['path'],e['status'],e['reason']) for e in plan['entries']],[('','needs_review',f'root_ancestor_{self.kind}_not_followed')])
        self.assert_never_escaped(plan)
        self.assertFalse(plan['scanComplete'])

    def test_ancestor_replaced_during_root_walk_is_refused(self):
        ancestor,nested,decoy=self.nested_fixture();swapped=[]
        # The parent of "ancestor" is already held when "ancestor" is replaced, just before its open.
        def hook(name):
            if name=='ancestor' and not swapped:swapped.append(self.swap_to_link(ancestor,decoy))
        with recorded_opens(self.backend,hook) as opened, patched_children(self.backend) as calls:
            plan=agent.plan_mount(nested)
        self.assertTrue(swapped);self.assertEqual(opened[-1],'ancestor');self.assertEqual(calls,[])
        self.assertEqual([(e['path'],e['status'],e['reason']) for e in plan['entries']],[('','needs_review',f'root_ancestor_{self.kind}_not_followed')])
        self.assert_never_escaped(plan)
        self.assertFalse(plan['scanComplete'])

    def test_ancestor_replaced_during_listing_does_not_redirect(self):
        ancestor,nested,decoy=self.nested_fixture();moved=ancestor.with_name('ancestor-moved');state={}
        def before(call):
            if call!=1:return
            try:rename_with_retry(ancestor,moved)
            except PermissionError:
                # Windows may refuse to rename an ancestor of an open directory handle: the denial path.
                state['refused']=True;return
            make_directory_link(self,ancestor,decoy);state['swapped']=True
            self.assertIn('outside-secret.pdf',os.listdir(nested))
        def after(call):
            if call==1 and state.get('swapped'):self.restore(ancestor,moved);state['restored']=True
        with patched_children(self.backend,before=before,after=after) as calls:plan=agent.plan_mount(nested)
        self.assertEqual(len(calls),1)
        if state.get('refused'):
            # Denied: no junction was placed, and the original tree stayed in place for the whole listing.
            self.assertNotIn('swapped',state)
        else:
            # Renamed: the junction swap really happened during the listing and was undone before return.
            self.assertTrue(state['swapped']);self.assertTrue(state['restored'])
        self.assertFalse(moved.exists());self.assertEqual(os.listdir(nested),['inside.pdf'])
        # Either way: no outside metadata, no deletion or absence inference, and completeness is
        # truthful for the original tree the held root handle listed.
        self.assert_never_escaped(plan)
        self.assertEqual([(e['path'],e['status']) for e in plan['entries']],[('inside.pdf','eligible')])
        self.assertIsNone(plan['failClosedReason']);self.assertTrue(plan['scanComplete'])


class SourceAgentWireTests(unittest.TestCase):
    """Exercise the shipped FoundationClient.upload against a local fake HTTP Foundation and object store."""
    def test_upload_uses_approved_capability_then_put_then_confirm_and_persists_confirmation(self):
        data=b"real fake HTTP upload bytes"
        digest='sha256:'+sha(data)
        attempt_key='attempt_wire_fixture_0001'
        file_key='fk_'+sha(b'wire file')[:40]
        document_id='22222222-2222-4222-8222-222222222222'
        scope_digest='sha256:'+'8'*64
        calls=[]
        state={'stored':False,'confirmed':False}
        server_box={}

        class Handler(BaseHTTPRequestHandler):
            protocol_version='HTTP/1.1'
            def log_message(self,*args): pass
            def send_json(self,status,payload):
                raw=json.dumps(payload,separators=(',',':')).encode()
                self.send_response(status);self.send_header('content-type','application/json');self.send_header('content-length',str(len(raw)));self.end_headers();self.wfile.write(raw)
            def do_POST(self):
                length=int(self.headers.get('content-length','0'));body=json.loads(self.rfile.read(length) or b'{}')
                calls.append((self.command,self.path,dict(self.headers),body))
                if self.path=='/api/v1/uploads/capability':
                    self.send_json(200,{'code':'QUALIFIED','documentId':document_id,'uploadUrl':server_box['base']+'/storage/put',
                        'contentLength':len(data),'declaredMimeType':'application/pdf','computeReservation':{'maximumCredits':2}});return
                if self.path=='/api/v1/uploads/confirm':
                    self.assert_auth()
                    if not state['stored'] or body.get('documentId')!=document_id or body.get('fileKey')!=file_key:
                        self.send_json(409,{'code':'UPLOAD_OBJECT_MISSING'});return
                    state['confirmed']=True
                    approved={'fileKey':file_key,'documentId':document_id,'fileState':'confirmed'}
                    self.send_json(200,{'code':'UPLOAD_CONFIRMED','approvedFile':approved});return
                self.send_json(404,{'code':'NOT_FOUND'})
            def do_GET(self):
                calls.append((self.command,self.path,dict(self.headers),None))
                if self.path.startswith('/api/v1/uploads/approval?'):
                    self.assert_auth()
                    files=[{'fileKey':file_key,'documentId':document_id,'fileState':'confirmed' if state['confirmed'] else 'approved'}]
                    self.send_json(200,{'approval':{'files':files}});return
                self.send_json(404,{'code':'NOT_FOUND'})
            def do_PUT(self):
                length=int(self.headers.get('content-length','0'));payload=self.rfile.read(length)
                calls.append((self.command,self.path,dict(self.headers),payload))
                state['stored']=payload==data
                self.send_response(200);self.send_header('content-length','0');self.end_headers()
            def assert_auth(self):
                if self.headers.get('authorization')!='Bearer '+API_KEY: raise AssertionError('Foundation bearer missing or wrong')

        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.daemon_threads=True
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        self.addCleanup(lambda:(server.shutdown(),server.server_close(),thread.join(timeout=2)))
        server_box['base']=f'http://127.0.0.1:{server.server_address[1]}'
        tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup)
        path=Path(tmp.name)/'approved.pdf';path.write_bytes(data)
        client=agent.FoundationClient(server_box['base'],API_KEY,2)
        member={'fileKey':file_key,'documentId':document_id,'originalFilename':'approved.pdf','mimeType':'application/pdf',
            'byteLength':len(data),'contentSha256':digest,'approvedMaximumCredits':2}
        attempt={'attemptKey':attempt_key,'scopeDigest':scope_digest,'pricingFingerprint':FINGERPRINT}

        self.assertEqual(client.upload(path,member,attempt),document_id)
        routes=[entry[1].split('?',1)[0] for entry in calls]
        self.assertEqual(routes,['/api/v1/uploads/capability','/storage/put','/api/v1/uploads/confirm'])
        capability=calls[0]
        self.assertEqual(capability[0],'POST');self.assertEqual(capability[3],{
            'originalFilename':'approved.pdf','declaredMimeType':'application/pdf','requestedBytes':len(data),
            'attemptKey':attempt_key,'scopeDigest':scope_digest,'pricingFingerprint':FINGERPRINT,
            'fileKey':file_key,'contentSha256':digest})
        headers={key.lower():value for key,value in capability[2].items()}
        self.assertEqual(headers.get('x-tavonel-source-idempotency-key'),expected_source_key(attempt_key,file_key))
        self.assertEqual(headers.get('authorization'),'Bearer '+API_KEY)
        self.assertEqual(calls[1][0],'PUT');self.assertEqual(calls[1][3],data)
        self.assertNotIn('authorization', {key.lower() for key in calls[1][2]})
        self.assertEqual({key.lower():value for key,value in calls[1][2].items()}.get('content-type'),'application/pdf')
        self.assertEqual(calls[2][3],{'documentId':document_id,'sourceSha256':digest,'attemptKey':attempt_key,
            'scopeDigest':scope_digest,'fileKey':file_key})
        self.assertTrue(state['confirmed'])


class FullSyncWireTests(unittest.TestCase):
    """Run the complete shipped sync flow against a bounded synthetic HTTP Foundation."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / 'source-root'; self.root.mkdir()
        self.state_path = Path(self.tmp.name) / 'state.json'
        self.calls = []
        self.store = {'approval': None, 'stored': False, 'confirmed': False,
                      'drop_approval_post': False, 'drop_approval_get': 0,
                      'drop_confirm_post': False, 'approval_posts': 0,
                      'put_refused': False, 'set_cancelled': False, 'drop_sync_reply': False,
                      'sync_batches': {}, 'sync_mutations': 0, 'cursor_advances': 0}
        box = {'base': None, 'store': self.store, 'calls': self.calls,
               'data': b'full sync wire bytes', 'document_id': str(uuid.uuid4()),
               'tmp_path': self.state_path}

        class Handler(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'
            def log_message(self, *args): pass
            def send_json(self, status, payload):
                raw = json.dumps(payload, separators=(',', ':')).encode()
                self.send_response(status); self.send_header('content-type', 'application/json')
                self.send_header('content-length', str(len(raw))); self.end_headers(); self.wfile.write(raw)
            def lose_reply(self):
                self.close_connection = True
                try: self.connection.shutdown(socket.SHUT_RDWR)
                except OSError: pass
                self.connection.close()
            def body(self):
                return json.loads(self.rfile.read(int(self.headers.get('content-length', '0'))) or b'{}')
            def auth(self):
                return self.headers.get('authorization') == 'Bearer ' + API_KEY
            def do_POST(self):
                body = self.body()
                box['calls'].append((self.command, self.path, dict(self.headers), body))
                store = box['store']
                if self.path == '/api/v1/uploads/quote':
                    if not self.auth(): return self.send_json(401, {'code':'UNAUTHORIZED'})
                    self.send_json(200, quote_for(body)); return
                if self.path == '/api/v1/uploads/approval':
                    if not self.auth(): return self.send_json(401, {'code':'UNAUTHORIZED'})
                    journal=Path(box['tmp_path'].with_name(box['tmp_path'].name+'.pending'))
                    box['calls'].append(('pending-before-approval',journal.exists()))
                    store['approval_posts'] += 1
                    store['approval'] = store['approval'] or approval_for(body)
                    if store['drop_approval_post']:
                        store['drop_approval_post'] = False; return self.lose_reply()
                    self.send_json(200, {'code':'INTAKE_APPROVED','approval':store['approval']}); return
                if self.path == '/api/v1/uploads/capability':
                    if not self.auth(): return self.send_json(401, {'code':'UNAUTHORIZED'})
                    journal=Path(box['tmp_path'].with_name(box['tmp_path'].name+'.pending'))
                    try:
                        intake=json.loads(journal.read_text(encoding='utf-8'))['intake']
                        persisted=(intake['attemptKey']==body.get('attemptKey')
                            and intake['approval']['scopeDigest']==store['approval']['scopeDigest']
                            and intake['members'][body.get('fileKey')]['documentId']==store['approval']['files'][0]['documentId'])
                    except (OSError,ValueError,KeyError,TypeError): persisted=False
                    box['calls'].append(('identities-before-capability',persisted))
                    member = next((f for f in store['approval']['files'] if f['fileKey']==body.get('fileKey')), None)
                    if member is None: return self.send_json(409, {'code':'INTAKE_APPROVAL_FILE_OUT_OF_SCOPE'})
                    self.send_json(200, {'code':'QUALIFIED','documentId':member['documentId'],
                        'uploadUrl':box['base']+'/storage/put','contentLength':len(box['data']),
                        'declaredMimeType':'application/pdf',
                        'computeReservation':{'maximumCredits':member['approvedMaximumCredits']}}); return
                if self.path == '/api/v1/uploads/confirm':
                    if not self.auth(): return self.send_json(401, {'code':'UNAUTHORIZED'})
                    if not store['stored']: return self.send_json(409, {'code':'UPLOAD_OBJECT_MISSING'})
                    member = next(f for f in store['approval']['files'] if f['fileKey']==body.get('fileKey'))
                    if body.get('documentId') != member['documentId']:
                        return self.send_json(409, {'code':'INTAKE_APPROVAL_CONFLICT'})
                    member['fileState']='confirmed'; store['confirmed']=True
                    if store['drop_confirm_post']:
                        store['drop_confirm_post']=False; return self.lose_reply()
                    self.send_json(200, {'code':'UPLOAD_CONFIRMED','approvedFile':member}); return
                if self.path == '/api/v1/uploads/release':
                    if not self.auth(): return self.send_json(401, {'code':'UNAUTHORIZED'})
                    self.send_json(200, {'code':'UPLOAD_CREDITS_RELEASED','result':{'fileKey':body.get('fileKey')}}); return
                if self.path == '/api/v1/uploads/approval/cancel':
                    if not self.auth(): return self.send_json(401, {'code':'UNAUTHORIZED'})
                    approval=store['approval']
                    if body.get('attemptKey') != approval['attemptKey'] or body.get('scopeDigest') != approval['scopeDigest']:
                        return self.send_json(409, {'code':'INTAKE_APPROVAL_CONFLICT'})
                    store['set_cancelled']=True; approval['state']='cancelled'
                    for member in approval['files']: member['fileState']='cancelled'
                    self.send_json(200, {'code':'INTAKE_SET_CANCELLED','result':{'status':'cancelled','reconciliationRequired':False}}); return
                if self.path == f'/api/v1/connections/{CONNECTION}/sync':
                    if not self.auth(): return self.send_json(401, {'code':'UNAUTHORIZED'})
                    approval=store['approval']
                    events=body.get('events')
                    if not store['confirmed'] or not isinstance(events,list) or len(events)!=1:
                        return self.send_json(409, {'code':'CONNECTION_BATCH_APPROVED_SOURCE_INVALID'})
                    event=events[0]
                    member=next((f for f in approval['files'] if f['documentId']==event.get('documentId')),None)
                    expected_key=expected_source_key(approval['attemptKey'],member['fileKey']) if member else None
                    if (member is None or member['fileState']!='confirmed'
                        or event.get('sourceIdempotencyKey')!=expected_key
                        or event.get('contentSha256')!=member['contentSha256'].split(':',1)[-1]
                        or event.get('sizeBytes')!=member['byteLength']
                        or event.get('mimeType')!=member['mimeType']
                        or member['fileKey']!=expected_file_key_from_digest(event.get('nativeId',''),
                            event.get('contentSha256',''),event.get('sizeBytes'),event.get('mimeType',''))):
                        return self.send_json(409, {'code':'CONNECTION_BATCH_APPROVED_SOURCE_INVALID'})
                    batch_id=body.get('batchId');manifest=body.get('manifestSha256')
                    previous=store['sync_batches'].get(batch_id)
                    if previous is not None and previous['manifestSha256']!=manifest:
                        return self.send_json(409, {'code':'CONNECTION_BATCH_CONFLICT'})
                    if previous is None:
                        store['sync_batches'][batch_id]={'manifestSha256':manifest,'nextCursorSha256':body.get('nextCursorSha256')}
                        store['sync_mutations']+=1;store['cursor_advances']+=1
                    box['calls'].append(('cursor-file-exists-before-accepted-reply', box['tmp_path'].exists()))
                    if store['drop_sync_reply']:
                        store['drop_sync_reply']=False;return self.lose_reply()
                    self.send_json(200, {'status':'replayed' if previous is not None else 'applied'}); return
                self.send_json(404, {'code':'NOT_FOUND'})
            def do_GET(self):
                box['calls'].append((self.command, self.path, dict(self.headers), None))
                store=box['store']
                if self.path.startswith('/api/v1/uploads/approval?'):
                    if not self.auth(): return self.send_json(401, {'code':'UNAUTHORIZED'})
                    if store['drop_approval_get']:
                        store['drop_approval_get'] -= 1; return self.lose_reply()
                    if store['approval'] is None: return self.send_json(404, {'code':'INTAKE_APPROVAL_NOT_FOUND'})
                    return self.send_json(200, {'approval':store['approval']})
                self.send_json(404, {'code':'NOT_FOUND'})
            def do_PUT(self):
                payload=self.rfile.read(int(self.headers.get('content-length','0')))
                box['calls'].append((self.command,self.path,dict(self.headers),payload))
                if self.path != '/storage/put' or self.headers.get('authorization') is not None:
                    return self.send_json(403, {'code':'OBJECT_STORE_REFUSED'})
                if box['store']['put_refused']:
                    self.send_json(403, {'code':'OBJECT_STORE_REFUSED'}); return
                box['store']['stored'] = payload == box['data']
                self.send_response(200); self.send_header('content-length','0'); self.end_headers()

        self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler); self.server.daemon_threads=True
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True); self.thread.start()
        self.addCleanup(lambda:(self.server.shutdown(),self.server.server_close(),self.thread.join(timeout=2)))
        base=f'http://127.0.0.1:{self.server.server_address[1]}'
        box['base']=base
        self.args=agent.parser().parse_args(['--root',str(self.root),'--connection-id',CONNECTION,'--state',str(self.state_path),
            '--base-url',base,'--approve-up-to-credits','100000','--allow-unknown-page-count','--timeout-seconds','2'])
        self.env=patch.dict(os.environ,{'TAVONEL_API_KEY':API_KEY}); self.env.start(); self.addCleanup(self.env.stop)
        self.addCleanup(self.tmp.cleanup)
        self.data=box['data']
        (self.root/'a.pdf').write_bytes(self.data)

    def request_paths(self):
        return [call[1] for call in self.calls if len(call)==4 and call[0] in {'GET','POST','PUT'}]

    def test_full_quote_approval_upload_commit_orders_cursor_after_accept(self):
        result=agent.sync(self.args)
        self.assertEqual(result['status'],'applied')
        methods_paths=[(call[0],call[1]) for call in self.calls if len(call)==4]
        self.assertEqual([pair for pair in methods_paths if pair[0] != 'GET'],[
            ('POST','/api/v1/uploads/quote'),('POST','/api/v1/uploads/approval'),
            ('POST','/api/v1/uploads/capability'),('PUT','/storage/put'),
            ('POST','/api/v1/uploads/confirm'),('POST',f'/api/v1/connections/{CONNECTION}/sync')])
        quote_body=next(c[3] for c in self.calls if c[1]=='/api/v1/uploads/quote')
        approval_body=next(c[3] for c in self.calls if c[1]=='/api/v1/uploads/approval')
        self.assertEqual(approval_body['clientManifestDigest'],quote_body['clientManifestDigest'])
        self.assertLessEqual(quote_for(quote_body)['quote']['maximumCredits'],self.args.approve_up_to_credits)
        self.assertTrue(self.store['confirmed']); self.assertTrue(self.state_path.exists())
        document_id=self.store['approval']['files'][0]['documentId']
        self.assertEqual(uuid.UUID(document_id).version,4)
        event=next(c[3]['events'][0] for c in self.calls if c[1]==f'/api/v1/connections/{CONNECTION}/sync')
        member=self.store['approval']['files'][0]
        self.assertEqual(event['documentId'],document_id)
        self.assertEqual(event['sourceIdempotencyKey'],expected_source_key(self.store['approval']['attemptKey'],member['fileKey']))
        self.assertIn(('pending-before-approval', True),self.calls)
        self.assertIn(('identities-before-capability', True),self.calls)
        commit_observation=next(c for c in self.calls if c[0]=='cursor-file-exists-before-accepted-reply')
        self.assertFalse(commit_observation[1], 'cursor state must wait until server accepted the complete event batch')

    def test_v4_approved_member_event_retry_replays_without_second_mutation_or_cursor_advance(self):
        self.store['drop_sync_reply']=True
        with self.assertRaises(agent.RetryableAgentError): agent.sync(self.args)
        journal=self.state_path.with_name(self.state_path.name+'.pending')
        self.assertTrue(journal.exists());self.assertFalse(self.state_path.exists())
        first=next(c[3] for c in self.calls if c[1]==f'/api/v1/connections/{CONNECTION}/sync')
        self.assertEqual(uuid.UUID(self.store['approval']['files'][0]['documentId']).version,4)
        self.assertEqual((self.store['sync_mutations'],self.store['cursor_advances']),(1,1))
        self.assertEqual(agent.sync(self.args)['status'],'replayed')
        commits=[c[3] for c in self.calls if c[1]==f'/api/v1/connections/{CONNECTION}/sync']
        self.assertEqual(commits,[first,first])
        self.assertEqual((self.store['sync_mutations'],self.store['cursor_advances']),(1,1))
        self.assertTrue(self.state_path.exists());self.assertFalse(journal.exists())
        self.assertEqual(sum(c[1]=='/storage/put' for c in self.calls if len(c)==4),1)

    def test_lost_approval_reply_reload_reads_committed_set_without_duplicate_post(self):
        self.store['drop_approval_post']=True; self.store['drop_approval_get']=1
        with self.assertRaises(agent.RetryableAgentError): agent.sync(self.args)
        journal=self.state_path.with_name(self.state_path.name+'.pending')
        self.assertTrue(journal.exists()); self.assertFalse(self.state_path.exists())
        pending=json.loads(journal.read_text(encoding='utf-8'))
        original=(pending['intake']['attemptKey'],pending['intake']['manifest'],pending['intake']['approvalBody'])
        self.assertEqual(self.store['approval_posts'],1)
        self.assertFalse(any(c[1]=='/api/v1/uploads/capability' for c in self.calls if len(c)==4))
        self.assertEqual(agent.sync(self.args)['status'],'applied')
        after=json.loads(journal.read_text(encoding='utf-8')) if journal.exists() else None
        self.assertIsNone(after)
        self.assertEqual(self.store['approval_posts'],1)
        self.assertEqual(sum(c[1]=='/api/v1/uploads/quote' for c in self.calls if len(c)==4),1)
        self.assertEqual(sum(c[1]=='/api/v1/uploads/capability' for c in self.calls if len(c)==4),1)
        self.assertEqual(sum(c[1]=='/storage/put' for c in self.calls if len(c)==4),1)
        self.assertEqual(sum(c[1]=='/api/v1/uploads/confirm' for c in self.calls if len(c)==4),1)
        self.assertEqual(self.store['approval']['attemptKey'],original[0])
        self.assertEqual(self.store['approval']['clientManifestDigest'],pending['intake']['clientManifestDigest'])
        self.assertEqual(next(c[3] for c in self.calls if c[1]=='/api/v1/uploads/approval'),original[2])
        capability=next(c for c in self.calls if c[1]=='/api/v1/uploads/capability')
        self.assertEqual(capability[3]['attemptKey'],original[0])
        self.assertEqual(capability[3]['fileKey'],original[1][0]['fileKey'])
        self.assertEqual({k.lower():v for k,v in capability[2].items()}['x-tavonel-source-idempotency-key'],
                         expected_source_key(original[0],original[1][0]['fileKey']))
        self.assertTrue(self.state_path.exists())

    def test_lost_confirmation_reply_reload_recovers_confirmed_member_without_reupload(self):
        self.store['drop_confirm_post']=True; self.store['drop_approval_get']=1
        with self.assertRaises(agent.RetryableAgentError): agent.sync(self.args)
        journal=self.state_path.with_name(self.state_path.name+'.pending')
        self.assertTrue(journal.exists()); self.assertFalse(self.state_path.exists())
        saved=json.loads(journal.read_text(encoding='utf-8'))['intake']
        identity=(saved['attemptKey'],saved['members'][saved['manifest'][0]['fileKey']].get('documentId'))
        self.assertTrue(self.store['confirmed'])
        self.assertEqual(agent.sync(self.args)['status'],'applied')
        self.assertEqual(self.store['approval']['attemptKey'],identity[0])
        self.assertEqual(self.store['approval']['files'][0]['documentId'],identity[1])
        self.assertEqual(sum(c[1]=='/api/v1/uploads/approval' for c in self.calls if len(c)==4),1)
        self.assertEqual(sum(c[1]=='/api/v1/uploads/capability' for c in self.calls if len(c)==4),1)
        self.assertEqual(sum(c[1]=='/storage/put' for c in self.calls if len(c)==4),1)
        self.assertEqual(sum(c[1]=='/api/v1/uploads/confirm' for c in self.calls if len(c)==4),1)
        self.assertTrue(self.state_path.exists()); self.assertFalse(journal.exists())

    def test_definitive_put_refusal_releases_member_then_cancels_whole_set(self):
        self.store['put_refused']=True
        with self.assertRaisesRegex(agent.ReviewRequiredError,'complete approved set was cancelled'):
            agent.sync(self.args)
        paths=[c[1] for c in self.calls if len(c)==4]
        self.assertLess(paths.index('/api/v1/uploads/release'),paths.index('/api/v1/uploads/approval/cancel'))
        self.assertTrue(self.store['set_cancelled'])
        cancel=next(c for c in self.calls if c[1]=='/api/v1/uploads/approval/cancel')
        self.assertEqual(cancel[3],{'attemptKey':self.store['approval']['attemptKey'],
            'scopeDigest':self.store['approval']['scopeDigest'],'fileKey':self.store['approval']['files'][0]['fileKey']})
        self.assertFalse(any(c[1]=='/api/v1/uploads/confirm' for c in self.calls if len(c)==4))

if __name__=='__main__':unittest.main()
