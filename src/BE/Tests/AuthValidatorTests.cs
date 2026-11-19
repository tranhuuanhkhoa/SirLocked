using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Auth;
using Xunit;

namespace SirLocked.Api.Tests;

public sealed class AuthValidatorTests
{
    [Fact]
    public void Register_ReportsEveryInvalidField()
    {
        var error = Assert.Throws<ApiException>(() => AuthValidator.Register(new RegisterRequest
        {
            FullName = " ", Email = "bad email", Password = "abcdef"
        }));
        Assert.Equal(400, error.StatusCode);
        var fields = Assert.IsType<Dictionary<string, string[]>>(error.Errors);
        Assert.Equal(["email", "fullName", "password"], fields.Keys.OrderBy(key => key));
    }

    [Theory]
    [InlineData("abc123")]
    [InlineData("A strong password 123")]
    public void Register_AcceptsValidInput(string password) => AuthValidator.Register(new RegisterRequest
    {
        FullName = "Detective Holmes", Email = "detective@example.com", Password = password
    });

    [Fact]
    public void ChangePassword_RejectsReuse()
    {
        var error = Assert.Throws<ApiException>(() => AuthValidator.ChangePassword(new ChangePasswordRequest
        {
            CurrentPassword = "abc123", NewPassword = "abc123"
        }));
        Assert.Contains("newPassword", Assert.IsType<Dictionary<string, string[]>>(error.Errors).Keys);
    }

    [Fact]
    public void ResetPassword_RequiresTokenAndValidPassword()
    {
        var error = Assert.Throws<ApiException>(() => AuthValidator.ResetPassword(new ResetPasswordRequest
        {
            Token = " ", NewPassword = "short"
        }));
        var fields = Assert.IsType<Dictionary<string, string[]>>(error.Errors);
        Assert.Contains("token", fields.Keys);
        Assert.Contains("newPassword", fields.Keys);
    }
}
