namespace SirLocked.Api.DTOs.Auth;

public sealed record AdminTwoFactorSetupResponse(string Secret, string OtpauthUri);
public sealed record AdminTwoFactorEnableResponse(IReadOnlyList<string> RecoveryCodes);
public sealed record AdminStepUpResponse(DateTime StepUpUntil);
