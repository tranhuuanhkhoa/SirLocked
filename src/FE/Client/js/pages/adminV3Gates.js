export const V3_PRESET = 'CRACK_THE_LIE_V3';

export function v3Profile(value = {}) {
  const settings = value.settings || {};
  return {
    mechanicsVersion: settings.mechanicsVersion ?? value.mechanicsVersion ?? 0,
    generationMode: settings.generationMode ?? value.generationMode ?? '',
    generationPreset: settings.generationPreset ?? value.generationPreset ?? '',
    includeCrackTheLie: settings.includeCrackTheLie ?? value.includeCrackTheLie ?? false,
    semanticStatus: value.v3SemanticReview?.status ?? value.aiSemanticReviewStatus ?? 'NOT_RUN',
    hasSourceDraft: Boolean(value.draftId || value.hasSourceAiDraft || value.sourceAiDraftId),
  };
}

export function isV3(value) {
  const profile = v3Profile(value);
  return profile.mechanicsVersion === 3 || profile.includeCrackTheLie || profile.generationPreset === V3_PRESET;
}

export function v3PublishGate(value, capabilities, deterministicValid = null) {
  const profile = v3Profile(value);
  if (!isV3(value)) {
    const checks = deterministicValid === null ? [] : [{
      key: 'deterministic',
      label: 'Deterministic validation',
      passed: deterministicValid,
      detail: deterministicValid ? 'Passed.' : 'Case validation has errors.',
    }];
    return { isV3: false, profile, checks, canPublish: deterministicValid !== false, reason: deterministicValid === false ? 'Deterministic validation failed.' : '' };
  }

  const gameplayKnown = typeof capabilities?.gameplayV3Enabled === 'boolean';
  const checks = [{
    key: 'gameplay',
    label: 'Gameplay V3 feature flag',
    passed: capabilities?.gameplayV3Enabled === true,
    detail: gameplayKnown
      ? (capabilities.gameplayV3Enabled ? 'Enabled.' : 'Disabled in this environment.')
      : 'Capability could not be verified.',
  }];

  if (profile.hasSourceDraft) {
    const canonical = profile.mechanicsVersion === 3 && profile.generationMode === 'CAMERA_EMBEDDED';
    checks.push({
      key: 'profile',
      label: 'Canonical V3 generation profile',
      passed: canonical,
      detail: canonical ? `Mechanics 3 · CAMERA_EMBEDDED · ${profile.generationPreset}.` : 'V3 must retain the selected V2 generation profile.',
    });
    checks.push({
      key: 'semantic',
      label: 'Independent Cartesian semantic review',
      passed: profile.semanticStatus === 'PASSED',
      detail: `Status: ${profile.semanticStatus || 'NOT_RUN'}.`,
    });
    checks.push({
      key: 'source',
      label: 'AI draft provenance',
      passed: profile.hasSourceDraft,
      detail: profile.hasSourceDraft ? 'Source draft is attached.' : 'Source draft metadata is missing.',
    });
  }

  if (deterministicValid !== null) {
    checks.push({
      key: 'deterministic',
      label: 'Deterministic validation',
      passed: deterministicValid,
      detail: deterministicValid ? 'Passed.' : 'Case validation has errors.',
    });
  }

  const failed = checks.find((check) => !check.passed);
  return {
    isV3: true,
    profile,
    checks,
    canPublish: !failed,
    reason: failed ? `${failed.label}: ${failed.detail}` : '',
  };
}
