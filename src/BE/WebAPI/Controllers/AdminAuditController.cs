using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Admin;

namespace SirLocked.Api.WebAPI.Controllers;

/// <summary>The admin audit log, newest first.</summary>
[Route("api/admin/audit")]
[Authorize(Roles = UserRole.Admin)]
public class AdminAuditController : BaseApiController
{
    private readonly IAdminAudit _audit;

    public AdminAuditController(IAdminAudit audit) => _audit = audit;

    [HttpGet]
    public async Task<ActionResult<ApiResponse<AdminAuditPageDto>>> List(
        [FromQuery] string? targetType,
        [FromQuery] string? targetId,
        [FromQuery] string? adminId,
        [FromQuery] string? action,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = AdminAuditService.DefaultPageSize,
        CancellationToken ct = default) =>
        Ok(await _audit.QueryAsync(new AdminAuditQuery(targetType, targetId, adminId, action, from, to, page, pageSize), ct));
}
