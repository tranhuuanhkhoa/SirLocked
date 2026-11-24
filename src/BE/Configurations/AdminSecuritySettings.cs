namespace SirLocked.Api.Configurations;

public sealed class AdminSecuritySettings
{
    public bool RequireTwoFactor { get; set; }
    public int StepUpMinutes { get; set; } = 5;
    public int EffectiveStepUpMinutes => StepUpMinutes > 0 ? StepUpMinutes : 5;
}
