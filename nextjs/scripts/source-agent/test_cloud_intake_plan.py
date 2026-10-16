"""Offline tests for the bounded cloud intake plan (--dry-run-plan with --s3-bucket).

Provenance: authored by Claude Opus 5.5 (claude-opus-5-5) without running it; the author had no
shell. The tests import the actual agent module and drive the real parser, run(), run_cloud_plan()
and plan_s3(). The provider is a synthetic in-process FakeS3 whose only working operation is
list_objects_v2; any other client attribute (GetObject, HeadObject, downloads, uploads, deletes)
raises. The plan's client constructor is patched to return it, so no boto3, botocore, credential,
network or provider is used. The constructor tests inject fake boto3/botocore modules into
sys.modules and inspect the arguments the real constructor passes. While a plan runs, sync,
state, journal, approval, upload, content-read, temporary-file, socket and HTTP paths are patched
to raise, and local file opens and listings are patched to raise too.

The corrective delta (same author, also unrun) adds dependency-free send-guard and constructor
sanitization cases, and CloudPlanRealSdkSendBoundaryTests, which drive the real installed
boto3/botocore serializer, endpoint resolution, signer and S3 region redirector with only the HTTP
session's send replaced and static synthetic credentials. Those cases skip by name when boto3 or
botocore is not importable; they run only where the SDK is on the path.
"""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import traceback
import types
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import ANY, patch

try:
    import boto3 as real_boto3
    import botocore.session as real_botocore_session
    from botocore.awsrequest import AWSResponse
    from botocore.exceptions import CredentialRetrievalError
except ImportError:
    real_boto3 = None

SPEC = importlib.util.spec_from_file_location('source_agent_cloud_plan', Path(__file__).resolve().parents[2] / 'public/developer/tavonel-source-agent.py')
agent = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(agent)

BUCKET = 'synthetic-bucket'
PREFIX = 'docs/'
ENDPOINT = 'https://minio.synthetic.invalid:9000'
API_KEY = 'tvnl_live_synthetic_cloud_fixture'
CONNECTION = '11111111-1111-4111-8111-111111111111'
MARKER = 'SYNTHETIC_CREDENTIAL_PROCESS_STDERR_MARKER'
FAILED = {'status': 'failed', 'code': 'SOURCE_SYNC_FAILED', 'checkpointPreserved': True}


def plan_policy(**budgets):
    policy = json.loads(agent.canonical(agent.PLAN_POLICY))
    policy['scanBudgets'].update(budgets)
    return policy


class FakeS3:
    """Scripted ListObjectsV2 pages; every other client operation is forbidden."""
    def __init__(self, *pages):
        self.pages = list(pages)
        self.calls = []

    def list_objects_v2(self, **kwargs):
        self.calls.append(dict(kwargs))
        if not self.pages:
            raise AssertionError('unexpected extra ListObjectsV2 request')
        page = self.pages.pop(0)
        if isinstance(page, BaseException):
            raise page
        return page

    def __getattr__(self, name):
        if name.startswith('__'):
            raise AttributeError(name)
        raise AssertionError(f'cloud plan touched forbidden client operation {name}')


class FakeClock:
    """Returns the given readings in order, then repeats the last."""
    def __init__(self, *readings):
        self.readings = list(readings)

    def __call__(self):
        return self.readings.pop(0) if len(self.readings) > 1 else self.readings[0]


def page(rows, *, truncated=False, token=None, **extra):
    value = {
        'IsTruncated': truncated,
        'Contents': [
            {'Key': key, 'Size': size, 'ETag': f'"synthetic-etag-{index}"', 'StorageClass': 'STANDARD'}
            for index, (key, size) in enumerate(rows)
        ],
    }
    if token is not None:
        value['NextContinuationToken'] = token
    value.update(extra)
    return value


def cloud_args(*extra, prefix=PREFIX):
    return agent.parser().parse_args(['--s3-bucket', BUCKET, '--s3-prefix', prefix, '--s3-endpoint-url', ENDPOINT, '--dry-run-plan', *extra])


@contextlib.contextmanager
def isolated(fake):
    forbidden = AssertionError('cloud plan reached a content, state, approval, upload, network or sync path')
    with contextlib.ExitStack() as stack:
        constructor = stack.enter_context(patch.object(agent, 's3_plan_client', return_value=fake))
        for name in ('s3_client', 'scan_s3', 'download_s3', 'plan_mount', 'FoundationClient', 'sync', '_sync',
                     'state_lock', 'read_state', 'write_state', 'write_journal', 'commit_pending',
                     'approve_and_upload', 'sealed_source', 'snapshot_mount', 'file_digest', 'source_fingerprint'):
            stack.enter_context(patch.object(agent, name, side_effect=forbidden))
        stack.enter_context(patch.dict(os.environ, {'TAVONEL_API_KEY': API_KEY}))
        # Process-wide I/O last, so resolving the earlier patch targets touches nothing on disk.
        for target in ('urllib.request.urlopen', 'urllib.request.build_opener', 'socket.socket',
                       'tempfile.mkstemp', 'tempfile.TemporaryDirectory',
                       'os.scandir', 'os.listdir', 'os.walk', 'os.stat', 'os.lstat', 'os.open',
                       'io.open', 'builtins.open'):
            stack.enter_context(patch(target, side_effect=forbidden))
        yield constructor


def run_cli(fake, args):
    out = []
    with isolated(fake) as constructor:
        code = agent.run(args, emit=out.append)
    return code, out, constructor


class CloudPlanTestCase(unittest.TestCase):
    def assert_plan(self, fake, out, *, prefix=PREFIX):
        self.assertEqual(len(out), 1)
        line = out[0]
        plan = json.loads(line)
        self.assertEqual(plan['schema'], agent.CLOUD_PLAN_SCHEMA)
        self.assertEqual(plan['source'], {'kind': 's3_compatible', 'bucket': BUCKET, 'prefix': prefix})
        self.assertFalse(plan['partialScanFinalized'])
        self.assertEqual(plan['absenceSemantics'], 'none')
        self.assertEqual(plan['policyScope'], 'default_policy_only_no_ignore_file_read')
        for flag in ('contentInspected', 'etagUsedAsContentHash', 'pageCountInspected', 'serviceAdmissionDetermined',
                     'unchangedContentClaimed', 'duplicateContentClaimed', 'submittedToService'):
            self.assertIs(plan[flag], False, flag)
        listing = plan['listing']
        self.assertEqual(listing['operation'], 'ListObjectsV2')
        self.assertEqual(listing['maxRequests'], 2)
        self.assertEqual(listing['requestsMade'], len(fake.calls))
        self.assertLessEqual(len(fake.calls), 2)
        self.assertEqual(listing['maxHttpAttempts'], 2)
        self.assertEqual(listing['httpAttemptGuard'], 'sdk_before_send_list_objects_v2_only')
        # The fake provider sends no HTTP, so the guard counted nothing (or plan_s3 ran without one).
        self.assertIn(listing['httpAttemptsSent'], (None, 0))
        self.assertIs(listing['usesProviderCredentials'], True)
        self.assertIs(listing['providerRequestCostEstimated'], False)
        self.assertIs(listing['continuationTokensReported'], False)
        self.assertIs(listing['inFlightRequestInterruptible'], False)
        for call in fake.calls:
            self.assertEqual(call['Bucket'], BUCKET)
            self.assertEqual(call['Prefix'], prefix)
            self.assertTrue(1 <= call['MaxKeys'] <= 1000)
            self.assertLessEqual(set(call), {'Bucket', 'Prefix', 'MaxKeys', 'ContinuationToken'})
        for secret in (API_KEY, ENDPOINT, 'minio.synthetic', 'synthetic-etag', 'opaque-token', 'ETag', 'StorageClass'):
            self.assertNotIn(secret, line)
        self.assertLessEqual(len(line.encode('utf-8')) + 1, plan['policy']['scanBudgets']['outputBytes'])
        self.assertEqual(sum(plan['counts'].values()), len(plan['entries']))
        self.assertEqual(plan['manifestSha256'], 'sha256:' + hashlib.sha256(agent.canonical(plan['entries']).encode('utf-8')).hexdigest())
        for entry in plan['entries']:
            self.assertEqual(entry['path'], entry['key'][len(prefix):])
            self.assertTrue(entry['key'].startswith(prefix))
        if plan['scanComplete']:
            self.assertEqual(plan['truncatedBy'], [])
            self.assertIsNone(plan['failClosedReason'])
        return plan


class CloudPlanListingTests(CloudPlanTestCase):
    def test_finite_complete_single_page_classifies_by_suffix_and_size_only(self):
        rows = [
            ('docs/a.pdf', 100),
            ('docs/sub/b.docx', 5242880),
            ('docs/big.pdf', 5242881),
            ('docs/notes.txt', 10),
            ('docs/Scan.TIF', 20),
            ('docs/folder/', 0),
            ('docs/.git/config', 5),
            ('docs/node_modules/x.pdf', 5),
            ('docs/.env', 5),
            ('docs/id_rsa', 5),
            ('docs/Thumbs.db', 5),
            ('docs/run.log', 5),
            ('docs/.cache/', 0),
        ]
        fake = FakeS3(page(rows, Name=BUCKET, Prefix=PREFIX, KeyCount=len(rows)))
        args = cloud_args()
        code, out, constructor = run_cli(fake, args)
        self.assertEqual(code, 0)
        constructor.assert_called_once_with(args, ANY)
        self.assertIsInstance(constructor.call_args.args[1], agent.CloudPlanSendGuard)
        self.assertEqual(fake.calls, [{'Bucket': BUCKET, 'Prefix': PREFIX, 'MaxKeys': 1000}])
        plan = self.assert_plan(fake, out)
        self.assertTrue(plan['scanComplete'])
        self.assertEqual([entry['key'] for entry in plan['entries']], [key for key, _ in rows])
        expected = {
            'docs/a.pdf': ('eligible', 'within_service_byte_ceiling_only_page_count_unknown'),
            'docs/sub/b.docx': ('eligible', 'within_service_byte_ceiling_only_page_count_unknown'),
            'docs/big.pdf': ('oversized', 'exceeds_service_byte_ceiling_needs_review'),
            'docs/notes.txt': ('unsupported', 'unsupported_file_type'),
            'docs/Scan.TIF': ('eligible', 'within_service_byte_ceiling_only_page_count_unknown'),
            'docs/folder/': ('needs_review', 'directory_marker_not_file_content'),
            'docs/.git/config': ('excluded_by_policy', 'excluded_generated_or_cache_directory'),
            'docs/node_modules/x.pdf': ('excluded_by_policy', 'excluded_generated_or_cache_directory'),
            'docs/.env': ('excluded_by_policy', 'excluded_credential_filename_pattern'),
            'docs/id_rsa': ('excluded_by_policy', 'excluded_credential_filename_pattern'),
            'docs/Thumbs.db': ('excluded_by_policy', 'excluded_credential_or_system_file'),
            'docs/run.log': ('excluded_by_policy', 'excluded_temporary_or_generated_suffix'),
            'docs/.cache/': ('excluded_by_policy', 'excluded_generated_or_cache_directory'),
        }
        entries = {entry['key']: entry for entry in plan['entries']}
        self.assertEqual({key: (entry['status'], entry['reason']) for key, entry in entries.items()}, expected)
        self.assertEqual(entries['docs/sub/b.docx']['path'], 'sub/b.docx')
        self.assertEqual(entries['docs/a.pdf']['mimeType'], 'application/pdf')
        self.assertEqual(entries['docs/Scan.TIF']['mimeType'], 'image/tiff')
        for key in ('docs/a.pdf', 'docs/sub/b.docx', 'docs/big.pdf', 'docs/Scan.TIF'):
            self.assertIsNone(entries[key]['pageCount'])
        self.assertEqual(entries['docs/folder/']['itemType'], 'directory_marker')
        self.assertEqual(entries['docs/.cache/']['itemType'], 'directory_marker')
        self.assertEqual(plan['candidateBytes'], 100 + 5242880 + 20)
        self.assertEqual(plan['visitedEntries'], len(rows))
        self.assertEqual(plan['counts'], {'eligible': 3, 'oversized': 1, 'unsupported': 1, 'needs_review': 1, 'excluded_by_policy': 7})
        # Same policy, fingerprint and service ceiling meaning as the mounted plan.
        self.assertEqual(plan['policy'], json.loads(agent.canonical(agent.PLAN_POLICY)))
        self.assertEqual(plan['policyFingerprint'], agent.sha256(agent.canonical(agent.PLAN_POLICY)))
        self.assertEqual(plan['policy']['serviceCeiling']['maxSourceBytes'], 5242880)

    def test_empty_complete_listing(self):
        fake = FakeS3({'IsTruncated': False, 'KeyCount': 0, 'Name': BUCKET, 'Prefix': PREFIX})
        code, out, _ = run_cli(fake, cloud_args())
        self.assertEqual(code, 0)
        plan = self.assert_plan(fake, out)
        self.assertTrue(plan['scanComplete'])
        self.assertEqual(plan['entries'], [])
        self.assertEqual(plan['counts'], {})
        self.assertEqual(len(fake.calls), 1)

    def test_prefix_boundary_and_segment_policy(self):
        fake = FakeS3(page([('docs/report.pdf', 7), ('docs/re/inner.pdf', 7)]))
        code, out, _ = run_cli(fake, cloud_args(prefix='docs/re'))
        self.assertEqual(code, 0)
        plan = self.assert_plan(fake, out, prefix='docs/re')
        self.assertEqual([(e['path'], e['status']) for e in plan['entries']], [('port.pdf', 'eligible'), ('/inner.pdf', 'eligible')])
        # A partial final prefix segment is matched against policy as the whole key segment.
        fake = FakeS3(page([('docs/.git/x.pdf', 7), ('docs/.github/y.pdf', 7)]))
        code, out, _ = run_cli(fake, cloud_args(prefix='docs/.gi'))
        plan = self.assert_plan(fake, out, prefix='docs/.gi')
        self.assertEqual([(e['key'], e['status']) for e in plan['entries']],
                         [('docs/.git/x.pdf', 'excluded_by_policy'), ('docs/.github/y.pdf', 'eligible')])

    def test_unsafe_key_names_are_reported_never_resolved(self):
        unsafe = ['docs/../escape.pdf', 'docs//double.pdf', 'docs/./dot.pdf', 'docs/back\\slash.pdf',
                  'docs/ctl\x01.pdf', 'docs/a/../b.pdf', 'docs/del\x7f.pdf']
        fake = FakeS3(page([(key, 3) for key in unsafe]))
        code, out, _ = run_cli(fake, cloud_args())
        self.assertEqual(code, 0)
        plan = self.assert_plan(fake, out)
        self.assertEqual([(e['key'], e['status'], e['reason']) for e in plan['entries']],
                         [(key, 'needs_review', 'key_not_a_safe_relative_name') for key in unsafe])
        self.assertEqual(plan['candidateBytes'], 0)
        fake = FakeS3(page([('/abs.pdf', 3), ('ok.pdf', 3)]))
        code, out, _ = run_cli(fake, cloud_args(prefix=''))
        plan = self.assert_plan(fake, out, prefix='')
        self.assertEqual([(e['key'], e['status']) for e in plan['entries']], [('/abs.pdf', 'needs_review'), ('ok.pdf', 'eligible')])

    def test_full_page_continuation_completes_within_two_requests(self):
        first = [(f'docs/p1/{index:04d}.pdf', 1) for index in range(1000)]
        second = [('docs/p2/a.pdf', 1), ('docs/p2/b.pdf', 1), ('docs/p2/c.pdf', 1)]
        fake = FakeS3(page(first, truncated=True, token='opaque-token-1'), page(second))
        code, out, _ = run_cli(fake, cloud_args())
        self.assertEqual(code, 0)
        self.assertEqual(fake.calls, [
            {'Bucket': BUCKET, 'Prefix': PREFIX, 'MaxKeys': 1000},
            {'Bucket': BUCKET, 'Prefix': PREFIX, 'MaxKeys': 1000, 'ContinuationToken': 'opaque-token-1'},
        ])
        plan = self.assert_plan(fake, out)
        self.assertTrue(plan['scanComplete'])
        self.assertEqual(len(plan['entries']), 1003)
        self.assertEqual(plan['candidateBytes'], 1003)

    def test_request_ceiling_stops_incomplete_with_exit_2(self):
        fake = FakeS3(
            page([('docs/a.pdf', 1), ('docs/b.pdf', 1)], truncated=True, token='opaque-token-1'),
            page([('docs/c.pdf', 1), ('docs/d.pdf', 1)], truncated=True, token='opaque-token-2'),
            page([('docs/e.pdf', 1)]),
        )
        code, out, _ = run_cli(fake, cloud_args())
        self.assertEqual(code, 2)
        self.assertEqual(len(fake.calls), 2)
        plan = self.assert_plan(fake, out)
        self.assertFalse(plan['scanComplete'])
        self.assertEqual(plan['truncatedBy'], ['request_count'])
        self.assertIsNone(plan['failClosedReason'])
        self.assertEqual([e['key'] for e in plan['entries']], ['docs/a.pdf', 'docs/b.pdf', 'docs/c.pdf', 'docs/d.pdf'])

    def test_max_keys_follows_the_remaining_allowance_and_extra_rows_are_never_kept(self):
        with patch.object(agent, 'PLAN_POLICY', plan_policy(manifestEntries=3)):
            fake = FakeS3(page([('docs/a.pdf', 1), ('docs/b.pdf', 1), ('docs/c.pdf', 1)], truncated=True, token='opaque-token-1'),
                          page([('docs/d.pdf', 1)]))
            code, out, _ = run_cli(fake, cloud_args())
            self.assertEqual(code, 2)
            self.assertEqual(fake.calls, [{'Bucket': BUCKET, 'Prefix': PREFIX, 'MaxKeys': 3}])
            plan = self.assert_plan(fake, out)
            self.assertEqual(plan['truncatedBy'], ['manifest_entries'])
            self.assertEqual(len(plan['entries']), 3)

            fake = FakeS3(page([(f'docs/{index}.pdf', 1) for index in range(5)]))
            code, out, _ = run_cli(fake, cloud_args())
            self.assertEqual(code, 2)
            self.assertEqual(fake.calls, [{'Bucket': BUCKET, 'Prefix': PREFIX, 'MaxKeys': 3}])
            plan = self.assert_plan(fake, out)
            self.assertEqual(plan['failClosedReason'], 'listing_page_exceeded_requested_max_keys')
            self.assertEqual(plan['entries'], [])
            self.assertEqual(plan['visitedEntries'], 0)
        with patch.object(agent, 'PLAN_POLICY', plan_policy(manifestEntries=3, fileCount=2)):
            fake = FakeS3(page([('docs/a.pdf', 1), ('docs/b.pdf', 1)], truncated=True, token='opaque-token-1'), page([]))
            code, out, _ = run_cli(fake, cloud_args())
            self.assertEqual(code, 2)
            self.assertEqual(fake.calls, [{'Bucket': BUCKET, 'Prefix': PREFIX, 'MaxKeys': 2}])
            plan = self.assert_plan(fake, out)
            self.assertEqual(plan['truncatedBy'], ['file_count'])

    def test_huge_utf8_keys_are_trimmed_to_the_output_budget(self):
        def key(index):
            return f'docs/{index:04d}-' + '가' * 330 + '.pdf'
        self.assertLessEqual(len(key(0).encode('utf-8')), 1024)
        first = [(key(index), 1) for index in range(1000)]
        second = [(key(index), 1) for index in range(1000, 2000)]
        fake = FakeS3(page(first, truncated=True, token='opaque-token-1'), page(second))
        code, out, _ = run_cli(fake, cloud_args())
        self.assertEqual(code, 2)
        plan = self.assert_plan(fake, out)
        self.assertFalse(plan['scanComplete'])
        self.assertEqual(plan['truncatedBy'], ['output_bytes'])
        self.assertEqual(plan['visitedEntries'], 2000)
        kept = [entry['key'] for entry in plan['entries']]
        self.assertTrue(0 < len(kept) < 2000)
        self.assertEqual(kept, [key(index) for index in range(len(kept))])

    def test_candidate_byte_budget_stops_without_keeping_later_rows(self):
        with patch.object(agent, 'PLAN_POLICY', plan_policy(candidateBytes=250)):
            fake = FakeS3(page([('docs/a.pdf', 100), ('docs/b.pdf', 100), ('docs/c.pdf', 100), ('docs/d.pdf', 10)]))
            code, out, _ = run_cli(fake, cloud_args())
        self.assertEqual(code, 2)
        plan = self.assert_plan(fake, out)
        self.assertEqual([(e['key'], e['status']) for e in plan['entries']],
                         [('docs/a.pdf', 'eligible'), ('docs/b.pdf', 'eligible'), ('docs/c.pdf', 'needs_review')])
        self.assertEqual(plan['entries'][2]['reason'], 'candidate_byte_budget_exceeded')
        self.assertEqual(plan['candidateBytes'], 200)
        self.assertEqual(plan['visitedEntries'], 3)
        self.assertEqual(plan['truncatedBy'], ['candidate_bytes'])
        self.assertFalse(plan['scanComplete'])

    def test_elapsed_budget_is_checked_before_requests_and_after_responses(self):
        cases = [
            # A slow first response keeps its rows and prevents the next request.
            ('slow_response', FakeClock(0.0, 0.0, 6.0), [page([('docs/a.pdf', 1)], truncated=True, token='opaque-token-1'), page([])], 1, ['docs/a.pdf']),
            # A slow final page is still reported incomplete.
            ('slow_final_page', FakeClock(0.0, 0.0, 5.0), [page([('docs/a.pdf', 1)])], 1, ['docs/a.pdf']),
            ('spent_before_first_request', FakeClock(0.0, 5.0), [page([('docs/a.pdf', 1)])], 0, []),
            ('spent_between_requests', FakeClock(0.0, 0.0, 1.0, 5.0), [page([('docs/a.pdf', 1)], truncated=True, token='opaque-token-1'), page([])], 1, ['docs/a.pdf']),
        ]
        for name, clock, pages, calls, keys in cases:
            with self.subTest(name):
                fake = FakeS3(*pages)
                with isolated(fake):
                    plan = agent.plan_s3(fake, BUCKET, PREFIX, clock=clock)
                self.assert_plan(fake, [agent.canonical(plan)])
                self.assertEqual(len(fake.calls), calls)
                self.assertEqual([e['key'] for e in plan['entries']], keys)
                self.assertEqual(plan['truncatedBy'], ['elapsed_time'])
                self.assertFalse(plan['scanComplete'])


class CloudPlanFailClosedTests(CloudPlanTestCase):
    def test_malformed_out_of_scope_duplicate_and_cycling_pages_fail_closed(self):
        valid = lambda: page([('docs/ok.pdf', 1)], truncated=True, token='opaque-token-1')
        cases = [
            ('not_a_dict', None, 'listing_completeness_marker_invalid'),
            ('marker_missing', {'Contents': []}, 'listing_completeness_marker_invalid'),
            ('marker_string', {'IsTruncated': 'false', 'Contents': []}, 'listing_completeness_marker_invalid'),
            ('marker_int', {'IsTruncated': 0, 'Contents': []}, 'listing_completeness_marker_invalid'),
            ('contents_not_list', {'IsTruncated': False, 'Contents': {'Key': 'docs/x.pdf', 'Size': 1}}, 'listing_entries_invalid'),
            ('entry_not_dict', {'IsTruncated': False, 'Contents': ['docs/x.pdf']}, 'listing_entry_invalid'),
            ('size_bool', page([('docs/x.pdf', True)]), 'listing_entry_invalid'),
            ('size_negative', page([('docs/x.pdf', -1)]), 'listing_entry_invalid'),
            ('size_float', page([('docs/x.pdf', 1.0)]), 'listing_entry_invalid'),
            ('size_string', page([('docs/x.pdf', '1')]), 'listing_entry_invalid'),
            ('size_missing', {'IsTruncated': False, 'Contents': [{'Key': 'docs/x.pdf'}]}, 'listing_entry_invalid'),
            ('key_missing', {'IsTruncated': False, 'Contents': [{'Size': 1}]}, 'listing_entry_invalid'),
            ('key_bytes', {'IsTruncated': False, 'Contents': [{'Key': b'docs/x.pdf', 'Size': 1}]}, 'listing_entry_invalid'),
            ('key_over_1024_bytes', page([('docs/' + 'a' * 1020 + '.pdf', 1)]), 'listing_entry_invalid'),
            ('key_lone_surrogate', page([('docs/\ud800.pdf', 1)]), 'listing_entry_invalid'),
            ('outside_prefix', page([('other/x.pdf', 1)]), 'listing_key_outside_selected_prefix'),
            ('parent_escape', page([('../docs/x.pdf', 1)]), 'listing_key_outside_selected_prefix'),
            ('prefix_sibling', page([('docsx/y.pdf', 1)]), 'listing_key_outside_selected_prefix'),
            ('duplicate_in_page', page([('docs/x.pdf', 1), ('docs/x.pdf', 1)]), 'listing_duplicate_key'),
            ('duplicate_across_pages', page([('docs/ok.pdf', 1)]), 'listing_duplicate_key'),
            ('inconsistent_duplicate_size', page([('docs/ok.pdf', 99)]), 'listing_duplicate_key'),
            ('token_missing', page([('docs/x.pdf', 1)], truncated=True), 'listing_continuation_token_missing'),
            ('token_empty', page([('docs/x.pdf', 1)], truncated=True, token=''), 'listing_continuation_token_missing'),
            ('token_not_string', page([('docs/x.pdf', 1)], truncated=True, token=5), 'listing_continuation_token_missing'),
            ('token_cycle', page([('docs/x.pdf', 1)], truncated=True, token='opaque-token-1'), 'listing_continuation_token_repeated'),
            ('key_count', page([('docs/x.pdf', 1)], KeyCount=2), 'listing_key_count_inconsistent'),
            ('wrong_bucket', page([('docs/x.pdf', 1)], Name='other-bucket'), 'listing_scope_mismatch'),
            ('wrong_prefix', page([('docs/x.pdf', 1)], Prefix=''), 'listing_scope_mismatch'),
            ('too_many_rows', page([(f'docs/r{index:04d}.pdf', 1) for index in range(1001)]), 'listing_page_exceeded_requested_max_keys'),
        ]
        for name, bad, reason in cases:
            with self.subTest(name):
                fake = FakeS3(valid(), bad)
                code, out, _ = run_cli(fake, cloud_args())
                self.assertEqual(code, 2)
                self.assertEqual(len(fake.calls), 2)
                self.assertEqual(fake.calls[1].get('ContinuationToken'), 'opaque-token-1')
                plan = self.assert_plan(fake, out)
                self.assertEqual(plan['failClosedReason'], reason)
                self.assertFalse(plan['scanComplete'])
                # Rows from the earlier valid page stay inspectable; nothing from the bad page is kept.
                self.assertEqual([(e['key'], e['status']) for e in plan['entries']], [('docs/ok.pdf', 'eligible')])
                self.assertEqual(plan['visitedEntries'], 1)

    def test_malformed_first_page_keeps_nothing(self):
        fake = FakeS3(page([('docs/a.pdf', 1), ('other/b.pdf', 1)]))
        code, out, _ = run_cli(fake, cloud_args())
        self.assertEqual(code, 2)
        plan = self.assert_plan(fake, out)
        self.assertEqual(plan['failClosedReason'], 'listing_key_outside_selected_prefix')
        self.assertEqual(plan['entries'], [])
        self.assertEqual(plan['visitedEntries'], 0)

    def test_provider_failure_is_sanitized(self):
        class FakeClientError(Exception):
            def __init__(self, code):
                super().__init__(f'denied for fixture-access-key-never-serialize at {ENDPOINT} with opaque-token-1 and secret provider detail')
                self.response = {'Error': {'Code': code, 'Message': 'secret provider detail'}}

        fake = FakeS3(FakeClientError('AccessDenied'))
        code, out, _ = run_cli(fake, cloud_args())
        self.assertEqual(code, 2)
        plan = self.assert_plan(fake, out)
        self.assertEqual(plan['failClosedReason'], 'listing_request_failed')
        self.assertEqual(plan['providerError'], {'errorType': 'FakeClientError', 'providerErrorCode': 'AccessDenied'})
        self.assertEqual(plan['entries'], [])
        for secret in ('fixture-access-key-never-serialize', 'AKIASYNTHETIC', 'secret provider detail'):
            self.assertNotIn(secret, out[0])

        fake = FakeS3(FakeClientError('Bad Code <script>'))
        code, out, _ = run_cli(fake, cloud_args())
        plan = self.assert_plan(fake, out)
        self.assertEqual(plan['providerError'], {'errorType': 'FakeClientError', 'providerErrorCode': None})

        fake = FakeS3(page([('docs/a.pdf', 1)], truncated=True, token='opaque-token-1'), OSError(f'reset by {ENDPOINT}'))
        code, out, _ = run_cli(fake, cloud_args())
        self.assertEqual(code, 2)
        plan = self.assert_plan(fake, out)
        self.assertEqual(plan['failClosedReason'], 'listing_request_failed')
        self.assertEqual(plan['providerError'], {'errorType': 'OSError', 'providerErrorCode': None})
        self.assertEqual([e['key'] for e in plan['entries']], ['docs/a.pdf'])

    def test_send_guard_refusal_stops_the_plan_with_its_static_reason(self):
        for reason in ('listing_http_attempt_cap_reached', 'listing_non_list_operation_refused'):
            with self.subTest(reason):
                fake = FakeS3(page([('docs/a.pdf', 1)], truncated=True, token='opaque-token-1'), agent.CloudPlanSendRefused(reason))
                code, out, _ = run_cli(fake, cloud_args())
                self.assertEqual(code, 2)
                plan = self.assert_plan(fake, out)
                self.assertFalse(plan['scanComplete'])
                self.assertEqual(plan['failClosedReason'], reason)
                self.assertIsNone(plan['providerError'])
                self.assertEqual([e['key'] for e in plan['entries']], ['docs/a.pdf'])

    def test_main_failure_output_is_sanitized(self):
        argv = ['tavonel-source-agent.py', '--s3-bucket', BUCKET, '--s3-endpoint-url', ENDPOINT, '--dry-run-plan']
        stdout = io.StringIO()
        with patch.object(sys, 'argv', argv), \
             patch.object(agent, 's3_plan_client', side_effect=agent.AgentError(f'boto3 unavailable for {ENDPOINT}')), \
             contextlib.redirect_stdout(stdout):
            self.assertEqual(agent.main(), 1)
        self.assertEqual(json.loads(stdout.getvalue()), {'status': 'failed', 'code': 'SOURCE_SYNC_FAILED', 'checkpointPreserved': True})
        self.assertNotIn('minio.synthetic', stdout.getvalue())

    def test_invalid_bucket_or_prefix_is_refused_before_any_client(self):
        for name, bucket, prefix in [('bucket_slash', 'bad/bucket', 'docs/'), ('bucket_empty', '', 'docs/'),
                                     ('prefix_over_1024_bytes', BUCKET, 'p' * 1025), ('prefix_lone_surrogate', BUCKET, '\udcff')]:
            with self.subTest(name):
                args = cloud_args()
                args.s3_bucket = bucket
                args.s3_prefix = prefix
                fake = FakeS3()
                with self.assertRaises(agent.AgentError):
                    with isolated(fake) as constructor:
                        agent.run(args, emit=lambda line: None)
                constructor.assert_not_called()
                self.assertEqual(fake.calls, [])


class CloudPlanIsolationTests(CloudPlanTestCase):
    def test_fake_provider_forbids_every_operation_but_listing(self):
        fake = FakeS3()
        for name in ('get_object', 'head_object', 'download_file', 'download_fileobj', 'put_object', 'delete_object', 'list_objects'):
            with self.subTest(name), self.assertRaises(AssertionError):
                getattr(fake, name)

    def test_no_state_lock_journal_approval_upload_or_content_reads(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp) / 'state.json'
            fake = FakeS3(page([('docs/a.pdf', 1)]))
            args = cloud_args('--connection-id', CONNECTION, '--state', str(state), '--approve-up-to-credits', '100')
            code, out, _ = run_cli(fake, args)
            self.assertEqual(code, 0)
            self.assert_plan(fake, out)
            for path in (state, state.with_name('state.json.lock'), state.with_name('state.json.pending')):
                self.assertFalse(path.exists())
            self.assertEqual(sorted(os.listdir(tmp)), [])

    def test_cli_routes_cloud_plan_and_leaves_the_mounted_branch_unchanged(self):
        fake = FakeS3(page([]))
        args = cloud_args()
        code, out, constructor = run_cli(fake, args)
        self.assertEqual(code, 0)
        constructor.assert_called_once_with(args, ANY)
        self.assertIsInstance(constructor.call_args.args[1], agent.CloudPlanSendGuard)
        self.assertEqual(json.loads(out[0])['schema'], agent.CLOUD_PLAN_SCHEMA)

        forbidden = AssertionError('mounted plan reached the cloud plan')
        with tempfile.TemporaryDirectory() as tmp:
            for complete, expected in ((True, 0), (False, 2)):
                stub = {'schema': agent.PLAN_SCHEMA, 'scanComplete': complete}
                out = []
                with patch.object(agent, 'plan_mount', return_value=stub) as plan_mount, \
                     patch.object(agent, 'run_cloud_plan', side_effect=forbidden), \
                     patch.object(agent, 's3_plan_client', side_effect=forbidden), \
                     patch.object(agent, 's3_client', side_effect=forbidden):
                    code = agent.run(agent.parser().parse_args(['--root', tmp, '--dry-run-plan']), emit=out.append)
                self.assertEqual(code, expected)
                plan_mount.assert_called_once_with(Path(tmp))
                self.assertEqual(out, [agent.canonical(stub)])

        with contextlib.redirect_stderr(io.StringIO()):
            for argv in (['--dry-run-plan'], ['--root', '.', '--s3-bucket', BUCKET, '--dry-run-plan'], ['--s3-bucket', BUCKET]):
                with self.subTest(argv=argv), self.assertRaises(SystemExit):
                    agent.parser().parse_args(argv)

    def test_help_distinguishes_local_and_cloud_plans(self):
        squashed = ''.join(agent.parser().format_help().split())
        for phrase in ('With --root: local metadata only, no credentials or API calls.',
                       "With --s3-bucket: at most 2 ListObjectsV2 requests using the host's boto3 credentials",
                       'may be billed', 'no object reads, no TAVONEL calls'):
            self.assertIn(''.join(phrase.split()), squashed)


class FakeEvents:
    """Minimal stand-in for botocore's hierarchical emitter: a handler on 'a.b' also hears 'a.b.c'.

    With deliver=False it accepts registrations but never calls them, like a misconfigured emitter.
    """
    def __init__(self, *, deliver=True):
        self.deliver = deliver
        self.handlers = []

    def register(self, event_name, handler, unique_id=None):
        self.handlers.append((event_name, handler, unique_id))

    def emit(self, event_name, **kwargs):
        if not self.deliver:
            return []
        return [handler(event_name=event_name, **kwargs) for name, handler, _ in self.handlers
                if event_name == name or event_name.startswith(name + '.')]


def fake_sdk(*, events=None, client=None, client_error=None, config_error=None):
    calls = {'config': [], 'client': []}
    if client is None:
        client = FakeS3()
        client.meta = SimpleNamespace(
            events=FakeEvents() if events is None else events,
            service_model=SimpleNamespace(service_id=SimpleNamespace(hyphenize=lambda: 's3')),
        )

    class Config:
        def __init__(self, **kwargs):
            calls['config'].append(kwargs)
            if config_error is not None:
                raise config_error

    def make_client(*args, **kwargs):
        calls['client'].append((args, kwargs))
        if client_error is not None:
            raise client_error
        return client

    boto3 = types.ModuleType('boto3')
    boto3.client = make_client
    botocore = types.ModuleType('botocore')
    config_module = types.ModuleType('botocore.config')
    config_module.Config = Config
    botocore.config = config_module
    return {'boto3': boto3, 'botocore': botocore, 'botocore.config': config_module}, calls, client


def assert_sanitized(case, exc):
    """No marker in the message or traceback, and no chained cause or context that could carry one."""
    case.assertIsInstance(exc, agent.AgentError)
    case.assertIsNone(exc.__cause__)
    case.assertIsNone(exc.__context__)
    case.assertNotIn(MARKER, str(exc) + ''.join(traceback.format_exception(type(exc), exc, exc.__traceback__)))


class CloudPlanClientTests(unittest.TestCase):
    def test_plan_client_disables_sdk_retries_and_bounds_socket_timeouts(self):
        modules, calls, client = fake_sdk()
        args = cloud_args('--s3-region', 'auto')
        with patch.dict(sys.modules, modules):
            self.assertIs(agent.s3_plan_client(args, agent.CloudPlanSendGuard()), client)
        self.assertEqual(calls['config'], [{'retries': {'total_max_attempts': 1, 'mode': 'standard'}, 'connect_timeout': 1.25, 'read_timeout': 1.25}])
        self.assertEqual(len(calls['client']), 1)
        positional, keywords = calls['client'][0]
        self.assertEqual(positional, ('s3',))
        # Only scope and the plan config: no credential, session or profile arguments.
        self.assertEqual(set(keywords), {'region_name', 'endpoint_url', 'config'})
        self.assertEqual((keywords['region_name'], keywords['endpoint_url']), ('auto', ENDPOINT))
        self.assertEqual(client.calls, [])
        connect, read = agent.cloud_plan_timeouts()
        self.assertEqual(agent.CLOUD_PLAN_MAX_REQUESTS * (connect + read), agent.PLAN_POLICY['scanBudgets']['elapsedSeconds'])
        with patch.object(agent, 'PLAN_POLICY', plan_policy(elapsedSeconds=2.0)):
            self.assertEqual(agent.cloud_plan_timeouts(), (0.5, 0.5))

    def test_plan_client_refuses_unsafe_endpoint_and_missing_sdk(self):
        modules, calls, _ = fake_sdk()
        args = cloud_args()
        args.s3_endpoint_url = 'http://minio.synthetic.invalid:9000'
        with patch.dict(sys.modules, modules), self.assertRaises(agent.AgentError):
            agent.s3_plan_client(args, agent.CloudPlanSendGuard())
        self.assertEqual(calls, {'config': [], 'client': []})
        with patch.dict(sys.modules, {'boto3': None}), self.assertRaises(agent.AgentError):
            agent.s3_plan_client(cloud_args(), agent.CloudPlanSendGuard())

    def test_sync_s3_client_keeps_sdk_defaults(self):
        modules, calls, client = fake_sdk()
        with patch.dict(sys.modules, modules):
            self.assertIs(agent.s3_client(SimpleNamespace(s3_endpoint_url=ENDPOINT, s3_region='auto')), client)
        self.assertEqual(calls['config'], [])
        self.assertEqual(calls['client'], [(('s3',), {'region_name': 'auto', 'endpoint_url': ENDPOINT})])
        # Sync installs no send guard.
        self.assertEqual(client.meta.events.handlers, [])

    def test_send_guard_passes_two_list_attempts_and_refuses_everything_else(self):
        guard = agent.CloudPlanSendGuard()
        for name in ('before-send.s3.HeadBucket', 'before-send.s3.GetObject', 'before-send.s3.HeadObject', 'before-send.s3', None):
            with self.subTest(name), self.assertRaises(agent.CloudPlanSendRefused) as refused:
                guard.before_send(event_name=name, request=None)
            self.assertEqual(refused.exception.reason, 'listing_non_list_operation_refused')
        self.assertEqual(guard.sent, 0)
        guard.before_send(event_name='before-send.s3.ListObjectsV2', request=None)
        guard.before_send(event_name='before-send.s3.ListObjectsV2', request=None)
        with self.assertRaises(agent.CloudPlanSendRefused) as refused:
            guard.before_send(event_name='before-send.s3.ListObjectsV2', request=None)
        self.assertEqual(refused.exception.reason, 'listing_http_attempt_cap_reached')
        self.assertEqual(guard.sent, 2)

    def test_plan_client_installs_its_guard_on_the_client_emitter(self):
        modules, _, client = fake_sdk()
        guard = agent.CloudPlanSendGuard()
        with patch.dict(sys.modules, modules):
            self.assertIs(agent.s3_plan_client(cloud_args(), guard), client)
        events = client.meta.events
        self.assertEqual([(name, unique) for name, _, unique in events.handlers], [('before-send.s3', 'tavonel-cloud-plan-send-guard')])
        # The wiring probe is a refused HeadBucket, so it is never counted as a send.
        self.assertEqual(guard.sent, 0)
        events.emit('before-send.s3.ListObjectsV2', request=None)
        events.emit('before-send.s3.ListObjectsV2', request=None)
        for operation in ('ListObjectsV2', 'HeadBucket', 'GetObject', 'HeadObject'):
            with self.subTest(operation), self.assertRaises(agent.CloudPlanSendRefused):
                events.emit(f'before-send.s3.{operation}', request=None)
        self.assertEqual(guard.sent, 2)
        self.assertEqual(client.calls, [])

    def test_unguarded_or_misconfigured_plan_client_fails_closed(self):
        class BrokenEvents(FakeEvents):
            def register(self, *args, **kwargs):
                raise TypeError('synthetic registration failure')

        cases = [
            ('emitter_never_delivers', dict(events=FakeEvents(deliver=False))),
            ('registration_raises', dict(events=BrokenEvents())),
            ('client_has_no_event_interface', dict(client=FakeS3())),
        ]
        for name, options in cases:
            with self.subTest(name):
                modules, _, client = fake_sdk(**options)
                with patch.dict(sys.modules, modules), self.assertRaises(agent.AgentError) as failed:
                    agent.s3_plan_client(cloud_args(), agent.CloudPlanSendGuard())
                assert_sanitized(self, failed.exception)
                self.assertEqual(client.calls, [])

    def test_plan_client_construction_errors_are_sanitized(self):
        class SyntheticCredentialError(Exception):
            pass

        for name, options in (('client', dict(client_error=SyntheticCredentialError(MARKER))),
                              ('config', dict(config_error=ValueError(MARKER)))):
            with self.subTest(name):
                modules, _, _ = fake_sdk(**options)
                with patch.dict(sys.modules, modules), self.assertRaises(agent.AgentError) as failed:
                    agent.s3_plan_client(cloud_args(), agent.CloudPlanSendGuard())
                assert_sanitized(self, failed.exception)

                argv = ['tavonel-source-agent.py', '--s3-bucket', BUCKET, '--s3-endpoint-url', ENDPOINT, '--dry-run-plan']
                stdout, stderr = io.StringIO(), io.StringIO()
                with patch.dict(sys.modules, modules), patch.object(sys, 'argv', argv), \
                     contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                    self.assertEqual(agent.main(), 1)
                self.assertEqual(json.loads(stdout.getvalue()), FAILED)
                self.assertEqual(stderr.getvalue(), '')
                self.assertNotIn(MARKER, stdout.getvalue())

        # Only regular exceptions are converted; an interrupt still propagates.
        modules, _, _ = fake_sdk(client_error=KeyboardInterrupt())
        with patch.dict(sys.modules, modules), self.assertRaises(KeyboardInterrupt):
            agent.s3_plan_client(cloud_args(), agent.CloudPlanSendGuard())


SDK_BUCKET = 'synthetic-offline-fixture'
SDK_PREFIX = 'team/'


class SyntheticBody:
    def __init__(self, data):
        self.data = data

    def stream(self, *args, **kwargs):
        yield self.data


def sdk_args():
    # No endpoint URL: the real AWS endpoint ruleset and region redirector apply.
    return agent.parser().parse_args(['--dry-run-plan', '--s3-bucket', SDK_BUCKET, '--s3-prefix', SDK_PREFIX])


def sdk_response(request, status, body=b'', headers=None):
    return AWSResponse(request.url, status, headers or {}, SyntheticBody(body))


def sdk_listing(request, keys, *, token=None):
    contents = ''.join(f'<Contents><Key>{key}</Key><Size>2</Size></Contents>' for key in keys)
    more = f'<NextContinuationToken>{token}</NextContinuationToken>' if token else ''
    body = (f'<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>{SDK_BUCKET}</Name>'
            f'<Prefix>{SDK_PREFIX}</Prefix><KeyCount>{len(keys)}</KeyCount><MaxKeys>1000</MaxKeys>'
            f'<IsTruncated>{"true" if token else "false"}</IsTruncated>{more}{contents}</ListBucketResult>')
    return sdk_response(request, 200, body.encode('utf-8'))


def sdk_redirect(request, *, region_header):
    body = b'<Error><Code>PermanentRedirect</Code><Message>Synthetic region redirect</Message></Error>'
    return sdk_response(request, 301, body, {'x-amz-bucket-region': 'eu-west-1'} if region_header else {})


@contextlib.contextmanager
def offline_aws_env():
    """Clear AWS_* configuration so no profile, endpoint override, credential chain or metadata
    service is consulted, use a fresh default session, and make any socket use fail the case."""
    forbidden = AssertionError('real-SDK case reached the network')
    with contextlib.ExitStack() as stack:
        stack.enter_context(patch.dict(os.environ))
        for name in [name for name in os.environ if name.startswith('AWS_')]:
            del os.environ[name]
        os.environ.update({'AWS_CONFIG_FILE': os.devnull, 'AWS_SHARED_CREDENTIALS_FILE': os.devnull,
                           'AWS_EC2_METADATA_DISABLED': 'true'})
        stack.enter_context(patch.object(real_boto3, 'DEFAULT_SESSION', None))
        for target in ('socket.socket', 'socket.create_connection', 'socket.getaddrinfo'):
            stack.enter_context(patch(target, side_effect=forbidden))
        yield


@unittest.skipIf(real_boto3 is None, 'real-SDK send-boundary cases need boto3/botocore importable (task-local SDK on the path)')
class CloudPlanRealSdkSendBoundaryTests(unittest.TestCase):
    """The real boto3/botocore serializer, endpoint resolution, signer and S3RegionRedirectorv2.

    Only the HTTP session's send is replaced: every attempt the SDK would put on the wire is
    recorded and answered from memory. Credentials are static synthetic values, so the credential
    chain never runs. Botocore's Stubber is not used because it answers before endpoint send and
    redirect handling.
    """

    @contextlib.contextmanager
    def offline_sdk(self, responder):
        sends = []
        original = real_boto3.client

        def client(service, **kwargs):
            made = original(service, **{**kwargs, 'region_name': 'us-east-1',
                                        'aws_access_key_id': 'SYNTHETIC_OFFLINE_KEY',
                                        'aws_secret_access_key': 'SYNTHETIC_OFFLINE_SECRET'})

            def send(request):
                sends.append(request.method)
                return responder(request, len(sends))

            made._endpoint.http_session.send = send
            return made

        with offline_aws_env(), patch.object(real_boto3, 'client', client):
            yield sends

    def run_plan(self, responder):
        out = []
        with self.offline_sdk(responder) as sends:
            code = agent.run_cloud_plan(sdk_args(), emit=out.append)
        self.assertEqual(len(out), 1)
        for secret in ('SYNTHETIC_OFFLINE', 'synthetic-token', 'amazonaws', 'eu-west-1'):
            self.assertNotIn(secret, out[0])
        return code, json.loads(out[0]), sends

    def test_region_redirect_and_pagination_refuse_the_third_list_attempt(self):
        def responder(request, ordinal):
            if ordinal == 1:
                return sdk_redirect(request, region_header=True)
            return sdk_listing(request, ['team/a.pdf'], token='synthetic-token-1')

        code, plan, sends = self.run_plan(responder)
        # Unguarded, the SDK sent GET, GET, GET and the plan reported a complete scan.
        self.assertEqual(sends, ['GET', 'GET'])
        self.assertEqual(code, 2)
        self.assertFalse(plan['scanComplete'])
        self.assertEqual(plan['failClosedReason'], 'listing_http_attempt_cap_reached')
        self.assertIsNone(plan['providerError'])
        self.assertEqual(plan['listing']['requestsMade'], 2)
        self.assertEqual(plan['listing']['httpAttemptsSent'], 2)
        self.assertEqual([e['key'] for e in plan['entries']], ['team/a.pdf'])

    def test_redirect_without_region_header_blocks_head_bucket_before_http(self):
        def responder(request, ordinal):
            if ordinal == 1:
                return sdk_redirect(request, region_header=False)
            if request.method == 'HEAD':
                return sdk_response(request, 200, headers={'x-amz-bucket-region': 'eu-west-1'})
            return sdk_listing(request, ['team/a.pdf'])

        code, plan, sends = self.run_plan(responder)
        # Unguarded, the SDK sent GET, HEAD, GET and the plan reported a complete scan.
        self.assertEqual(sends, ['GET'])
        self.assertEqual(code, 2)
        self.assertFalse(plan['scanComplete'])
        self.assertEqual(plan['failClosedReason'], 'listing_non_list_operation_refused')
        self.assertIsNone(plan['providerError'])
        self.assertEqual(plan['listing']['requestsMade'], 1)
        self.assertEqual(plan['listing']['httpAttemptsSent'], 1)
        self.assertEqual(plan['entries'], [])

    def test_finite_and_two_page_listings_still_complete(self):
        def single(request, ordinal):
            return sdk_listing(request, ['team/a.pdf', 'team/b.pdf'])

        code, plan, sends = self.run_plan(single)
        self.assertEqual((code, sends), (0, ['GET']))
        self.assertTrue(plan['scanComplete'])
        self.assertEqual((plan['listing']['requestsMade'], plan['listing']['httpAttemptsSent']), (1, 1))
        self.assertEqual([e['key'] for e in plan['entries']], ['team/a.pdf', 'team/b.pdf'])

        def two_pages(request, ordinal):
            if ordinal == 1:
                return sdk_listing(request, ['team/a.pdf'], token='synthetic-token-1')
            return sdk_listing(request, ['team/b.pdf'])

        code, plan, sends = self.run_plan(two_pages)
        self.assertEqual((code, sends), (0, ['GET', 'GET']))
        self.assertTrue(plan['scanComplete'])
        self.assertEqual((plan['listing']['requestsMade'], plan['listing']['httpAttemptsSent']), (2, 2))
        self.assertEqual([e['key'] for e in plan['entries']], ['team/a.pdf', 'team/b.pdf'])

    def test_sync_client_gets_no_guard_from_a_plan_client(self):
        def responder(request, ordinal):
            return sdk_response(request, 200, headers={'x-amz-bucket-region': 'us-east-1'})

        with self.offline_sdk(responder) as sends:
            plan_client = agent.s3_plan_client(sdk_args(), agent.CloudPlanSendGuard())
            sync_client = agent.s3_client(sdk_args())
            with self.assertRaises(agent.CloudPlanSendRefused):
                plan_client.head_bucket(Bucket=SDK_BUCKET)
            sync_client.head_bucket(Bucket=SDK_BUCKET)
        self.assertEqual(sends, ['HEAD'])

    def test_credential_retrieval_error_at_construction_is_sanitized(self):
        error = CredentialRetrievalError(provider='custom-process', error_msg=MARKER)
        self.assertIn(MARKER, str(error))
        with offline_aws_env(), patch.object(real_boto3, 'client', side_effect=error), \
             self.assertRaises(agent.AgentError) as failed:
            agent.s3_plan_client(sdk_args(), agent.CloudPlanSendGuard())
        assert_sanitized(self, failed.exception)

        argv = ['tavonel-source-agent.py', '--dry-run-plan', '--s3-bucket', SDK_BUCKET, '--s3-prefix', SDK_PREFIX]
        stdout, stderr = io.StringIO(), io.StringIO()
        with offline_aws_env(), patch.object(real_boto3, 'client', side_effect=error), patch.object(sys, 'argv', argv), \
             contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            self.assertEqual(agent.main(), 1)
        self.assertEqual(json.loads(stdout.getvalue()), FAILED)
        self.assertEqual(stderr.getvalue(), '')
        self.assertNotIn(MARKER, stdout.getvalue())

    def test_credential_retrieval_error_inside_the_real_constructor_is_sanitized(self):
        # The real boto3.client runs; only the session's credential lookup raises. Whether this SDK
        # resolves credentials at construction (exit 1) or at signing (incomplete plan, exit 2), no
        # HTTP attempt is sent and no provider text reaches the output.
        error = CredentialRetrievalError(provider='custom-process', error_msg=MARKER)
        argv = ['tavonel-source-agent.py', '--dry-run-plan', '--s3-bucket', SDK_BUCKET, '--s3-prefix', SDK_PREFIX]
        stdout, stderr = io.StringIO(), io.StringIO()
        with offline_aws_env(), patch.object(real_botocore_session.Session, 'get_credentials', side_effect=error), \
             patch.object(sys, 'argv', argv), contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = agent.main()
        self.assertIn(code, (1, 2))
        self.assertEqual(stderr.getvalue(), '')
        self.assertNotIn(MARKER, stdout.getvalue())
        if code == 1:
            self.assertEqual(json.loads(stdout.getvalue()), FAILED)
        else:
            plan = json.loads(stdout.getvalue())
            self.assertEqual(plan['listing']['httpAttemptsSent'], 0)
            self.assertEqual(plan['failClosedReason'], 'listing_request_failed')


if __name__ == '__main__':
    unittest.main()
