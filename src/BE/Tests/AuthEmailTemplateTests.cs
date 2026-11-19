using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Api.Tests;

public sealed class AuthEmailTemplateTests
{
    [Fact]
    public void ResetEmail_UsesAuthCardDesignAndEscapesUserContent()
    {
        var html = EmailService.BuildEmail(
            "Detective <script>", "Liên kết hết hạn sau 30 phút.", "Đặt lại mật khẩu",
            "https://example.test/#/reset-password?token=a&b=c", "Sao chép liên kết.", "Bỏ qua nếu không yêu cầu.");

        Assert.Contains("#fbf6ed", html);
        Assert.Contains("#9e3f2a", html);
        Assert.Contains("BẢNG PHÁ ÁN · 221B", html);
        Assert.Contains("Detective &lt;script&gt;", html);
        Assert.DoesNotContain("Detective <script>", html);
        Assert.Contains("token=a&amp;b=c", html);
        Assert.Contains("role=\"presentation\"", html);
    }
}
