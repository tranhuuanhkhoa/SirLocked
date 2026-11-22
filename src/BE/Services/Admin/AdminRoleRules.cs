using SirLocked.Api.DTOs;

namespace SirLocked.Api.Services.Admin;

public static class AdminRoleRules
{
    public static void ValidateLastSuperAdminDemotion(long effectiveSuperAdmins)
    {
        if (effectiveSuperAdmins <= 1)
            throw ApiException.Conflict("At least one effective SUPER_ADMIN must remain.",
                "LAST_SUPER_ADMIN", "admin.lastSuperAdmin");
    }
}
