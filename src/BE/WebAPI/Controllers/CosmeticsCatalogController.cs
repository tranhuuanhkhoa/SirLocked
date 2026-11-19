using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.Services.Admin;

namespace SirLocked.Api.WebAPI.Controllers;

/// <summary>
/// How every cosmetic is drawn, for players' pages. The market catalog leaves retired items out, but someone may still
/// wear one in a lobby, so this keeps them.
/// </summary>
[Route("api/cosmetics")]
[Authorize]
public class CosmeticsCatalogController : BaseApiController
{
    private readonly AdminCosmeticsService _cosmetics;

    public CosmeticsCatalogController(AdminCosmeticsService cosmetics) => _cosmetics = cosmetics;

    [HttpGet("catalog")]
    public async Task<ActionResult<ApiResponse<CosmeticCatalogDto>>> Catalog(CancellationToken ct) =>
        Ok(await _cosmetics.PublicCatalogAsync(ct));
}
