import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('playtest_kit', Path(__file__).with_name('playtest-kit.py'))
kit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kit)

class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.manifest = {'buildCommit': 'commit', 'sandboxChecksum': 'case', 'bundleHash': 'bundle'}
        self.session = {'id': 'A01', 'locale': 'en'}
        self.observations = [{'session_id': 'A01', 'build_commit': 'commit', 'sandbox_locale': 'en', 'sandbox_checksum': 'case',
                              'elapsed_seconds': str(t), 'investigator_actionable': '1', 'interrogator_actionable': '1',
                              'investigator_action': 'EXPLORING', 'interrogator_action': 'READING_PRIVATE',
                              'communication_state': 'SHARING', 'waiting_role': 'NONE', 'waiting_episode_seconds': '0',
                              'wrong_pair_count': '0', 'edit_count': '0', 'clarification_count': '0',
                              'private_detail_spoken_before_review': '1', 'facilitator_intervention': '0',
                              'intervention_category': 'NONE', 'technical_error': '0'} for t in (0, 30, 60)]
        self.surveys = [{'session_id': 'A01', 'role': role, 'has_seen_answer': '0', 'completed_case': '1', 'comprehension_score': '4',
                         'wants_next_case': '1', 'blocking_errors': '0'} for role in kit.ROLES]
        self.telemetry = {'sessionId': 'A01', 'bundleHash': 'bundle', 'summary': {'eventCount': 9, 'sessionCount': 1,
                          'isTruncated': False, 'waitingImbalancePct': 10}}

    def assess(self, observations=None, surveys=None, telemetry=None):
        return kit.assess_session(self.manifest, self.session, observations if observations is not None else self.observations,
                                  surveys if surveys is not None else self.surveys, telemetry if telemetry is not None else self.telemetry)

    def test_empty_templates_are_not_run(self):
        result = kit.assess_session(self.manifest, self.session, [{'elapsed_seconds': '0'}], [{'role': 'INVESTIGATOR'}], None)
        self.assertEqual('NOT RUN', result['status'])

    def test_complete_evidence_meets_initial_thresholds(self):
        self.assertEqual('PASS', self.assess()['status'])

    def test_build_mismatch_cannot_pass(self):
        self.observations[0]['build_commit'] = 'different'
        self.assertEqual('INCOMPLETE', self.assess()['status'])

    def test_missing_intervals_cannot_pass(self):
        self.observations.pop(1)
        self.assertEqual('INCOMPLETE', self.assess()['status'])

    def test_duplicate_roles_cannot_pass(self):
        self.surveys[1]['role'] = self.surveys[0]['role']
        self.assertEqual('INCOMPLETE', self.assess()['status'])

    def test_unknown_waiting_is_not_zero(self):
        self.telemetry['summary']['waitingImbalancePct'] = None
        self.assertEqual('INCOMPLETE', self.assess()['status'])

    def test_mixed_rooms_cannot_pass(self):
        self.telemetry['summary']['sessionCount'] = 2
        self.assertEqual('INCOMPLETE', self.assess()['status'])

    def test_known_answers_invalidate_session(self):
        self.surveys[0]['has_seen_answer'] = '1'
        self.assertEqual('INCOMPLETE', self.assess()['status'])

    def test_technical_blocker_requires_iteration(self):
        self.surveys[1]['blocking_errors'] = '1'
        self.assertEqual('FAIL', self.assess()['status'])

    def test_bundle_checksum_detects_changed_artifact(self):
        import hashlib
        import json
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/'api').mkdir()
            (root/'api/game.dll').write_bytes(b'original')
            files = kit.bundle_files(root)
            kit.write_json(root/'manifest.json', {'files': files, 'bundleHash': hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()})
            kit.verify(root)
            (root/'api/game.dll').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'Frozen bundle changed'):
                kit.verify(root)

if __name__ == '__main__':
    unittest.main()
