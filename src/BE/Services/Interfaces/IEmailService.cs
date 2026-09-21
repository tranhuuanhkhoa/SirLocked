namespace SirLocked.Api.Services.Interfaces;

public interface IEmailService
{
    Task SendVerificationEmailAsync(string toEmail, string fullName, string token);
    Task SendPasswordResetEmailAsync(string toEmail, string fullName, string token);
}
