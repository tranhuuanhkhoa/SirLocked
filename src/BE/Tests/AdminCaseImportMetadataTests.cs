using System.Reflection;
using System.Text.Json;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.WebAPI.Controllers;
using Xunit;

namespace SirLocked.Tests;

/// <summary>
/// The studio's local playtest imports an AI case with its server metadata intact; Production never honours the flag.
/// </summary>
public class AdminCaseImportMetadataTests
{
    [Theory]
    [InlineData("Development", true, true)]
    [InlineData("Testing", true, true)]
    [InlineData("Production", true, false)]
    [InlineData("Development", false, false)]
    public async Task ImportJson_PreservesServerMetadata_OnlyOutsideProduction(string environment, bool requested, bool expected)
    {
        var cases = DispatchProxy.Create<ICaseService, RecordingCaseService>();
        var controller = new AdminCasesController(cases, legacy: null!, new FakeEnvironment(environment));
        using var document = JsonDocument.Parse("{\"caseId\":\"case-x\"}");

        await controller.ImportJson(new CaseJsonRequest { CaseJson = document.RootElement, Overwrite = true, PreserveServerMetadata = requested });

        var recorder = (RecordingCaseService)(object)cases;
        Assert.Equal(expected, recorder.Preserve);
        Assert.True(recorder.Overwrite);
    }

    [Fact]
    public async Task ImportJson_WithoutAnEnvironment_NeverPreserves()
    {
        var cases = DispatchProxy.Create<ICaseService, RecordingCaseService>();
        var controller = new AdminCasesController(cases, legacy: null!);
        using var document = JsonDocument.Parse("{\"caseId\":\"case-x\"}");
        await controller.ImportJson(new CaseJsonRequest { CaseJson = document.RootElement, PreserveServerMetadata = true });
        Assert.False(((RecordingCaseService)(object)cases).Preserve);
    }

    public class RecordingCaseService : DispatchProxy
    {
        public bool? Preserve { get; private set; }
        public bool Overwrite { get; private set; }

        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
        {
            if (targetMethod?.Name != nameof(ICaseService.ImportJsonAsync))
                throw new NotSupportedException(targetMethod?.Name);
            Overwrite = (bool)args![1]!;
            Preserve = (bool)args[2]!;
            return Task.FromResult(new CaseSummaryResponse { CaseId = "case-x" });
        }
    }

    private sealed class FakeEnvironment(string name) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = name;
        public string ApplicationName { get; set; } = "SirLocked.Api";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
