using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Vip;
using Xunit;

namespace SirLocked.Tests;

/// <summary>VUAN-7 settings (prices, models, hints, authors) and the VIP order's PixelLab cap.</summary>
public sealed class VipSettingsTests
{
    [Fact]
    public void Defaults_AreValid_AndFollowThePriceTableOfPartOne()
    {
        var pricing = new VipPricingSettings();
        VipSettingsStore.ValidatePricing(pricing);
        VipSettingsStore.ValidateModels(new VipModelSettings());
        VipSettingsStore.ValidateHints(new HintPricingSettings());
        VipSettingsStore.ValidateAuthors(new AuthorRewardSettings());

        Assert.Equal((5_000L, 2_500L), (pricing.PresetPrice(AiGenerationPresets.ShortDemo).FastXu, pricing.PresetPrice(AiGenerationPresets.ShortDemo).SaverXu));
        Assert.Equal((8_000L, 4_500L), (pricing.PresetPrice(AiGenerationPresets.NormalRandom).FastXu, pricing.PresetPrice(AiGenerationPresets.NormalRandom).SaverXu));
        Assert.Equal(9_500, pricing.PresetPrice(AiGenerationPresets.DialogueHeavy).FastXu);
        Assert.Equal(14_000, pricing.PresetPrice(AiGenerationPresets.FullFeature).FastXu);
        Assert.Equal(15, pricing.ExtraPixelLabGenerationXu);
        Assert.Equal(0m, pricing.MaxBonusShare); // ordinary coins only until Yen decides
        var models = new VipModelSettings();
        Assert.Equal((VipModelIds.Haiku, VipModelIds.Sonnet, VipModelIds.Opus, 3), (models.Light, models.Main, models.Rescue, models.RescueFromAttempt));
        var hints = new HintPricingSettings();
        Assert.Equal((20L, 50L, 5, 15), (hints.Level2Xu, hints.Level3Xu, hints.Level2PenaltyPercent, hints.Level3PenaltyPercent));
        var authors = new AuthorRewardSettings();
        Assert.Equal((30, 7, 100, 85, 1_500L, 500, 90, 5_000L),
            (authors.RevenueSharePercent, authors.HoldDays, authors.SilverCompletions, authors.SilverMinRatingPercent, authors.SilverBonusXu,
                authors.GoldCompletions, authors.GoldMinRatingPercent, authors.GoldBonusXu));
    }

    [Fact]
    public void BadValues_AreRefusedWithTheField()
    {
        var bonus = Assert.Throws<ApiException>(() => VipSettingsStore.ValidatePricing(new VipPricingSettings { MaxBonusShare = 0.5m }));
        Assert.Equal("vipPricing.maxBonusShare", Assert.IsType<ApiErrorDetails>(bonus.Errors).Field);
        var missing = new VipPricingSettings();
        missing.Presets.RemoveAll(item => item.Preset == AiGenerationPresets.FullFeature);
        Assert.Throws<ApiException>(() => VipSettingsStore.ValidatePricing(missing));
        Assert.Throws<ApiException>(() => VipSettingsStore.ValidateModels(new VipModelSettings { Main = "gpt-5" }));
        Assert.Throws<ApiException>(() => VipSettingsStore.ValidateModels(new VipModelSettings
        {
            StepOverrides = new() { ["Plan Scene"] = VipModelIds.Opus }
        }));
        Assert.Throws<ApiException>(() => VipSettingsStore.ValidateHints(new HintPricingSettings { Level3PenaltyPercent = 80 }));
        Assert.Throws<ApiException>(() => VipSettingsStore.ValidateAuthors(new AuthorRewardSettings { GoldCompletions = 10 }));
    }

    [Theory]
    [InlineData(0, 30)]
    [InlineData(30, 60)]
    [InlineData(45, 60)]
    [InlineData(70, 60)]
    public void AVipBuysPixelLabGenerationsInPacksOfThirty_UpToTheSetting(int extra, int cap)
    {
        var order = AiCaseOrderPolicy.Normalize(new AiCaseOrder { VipExtraPixelLab = extra, PixelLabCap = 100, Speed = "saver" }, UserRole.Vip, 60);

        Assert.Equal(cap, order.PixelLabCap);
        Assert.Equal(cap - 30, order.VipExtraPixelLab);
        Assert.Equal(VipSpeeds.Saver, order.Speed);
    }

    [Fact]
    public void AVipWhoSendsNoExtra_IsNeverChargedForMore_AndAdminOrdersKeepTheirCap()
    {
        Assert.Equal(30, AiCaseOrderPolicy.Normalize(new AiCaseOrder(), UserRole.Vip, 60).PixelLabCap); // the model default is 60
        var admin = AiCaseOrderPolicy.Normalize(new AiCaseOrder { PixelLabCap = 100, Speed = VipSpeeds.Saver }, UserRole.Admin, 60);
        Assert.Equal((100, VipSpeeds.Fast), (admin.PixelLabCap, admin.Speed));
    }
}
