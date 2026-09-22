using System.Net;
using System.Net.Mail;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public class EmailService : IEmailService
{
    private readonly EmailSettings _settings;
    private readonly ILogger<EmailService> _logger;

    public EmailService(IOptions<EmailSettings> settings, ILogger<EmailService> logger)
    {
        _settings = settings.Value;
        _logger = logger;
    }

    public Task SendVerificationEmailAsync(string toEmail, string fullName, string token)
    {
        var link = $"{_settings.FrontendUrl.TrimEnd('/')}/#/verify-email?token={Uri.EscapeDataString(token)}";
        var body = BuildEmail(
            fullName,
            "Cảm ơn bạn đã đăng ký SirLocked. Nhấn nút bên dưới để xác minh email và mở khóa trò chơi:",
            "Xác minh tài khoản",
            link,
            "Nếu nút không hoạt động, sao chép liên kết này vào trình duyệt:",
            "Nếu bạn không đăng ký tài khoản này, hãy bỏ qua email.");

        return SendAsync(toEmail, "Xác minh tài khoản — SirLocked", body);
    }

    public Task SendPasswordResetEmailAsync(string toEmail, string fullName, string token)
    {
        var link = $"{_settings.FrontendUrl.TrimEnd('/')}/#/reset-password?token={Uri.EscapeDataString(token)}";
        var body = BuildEmail(
            fullName,
            "Bạn đã yêu cầu đặt lại mật khẩu. Nhấn nút bên dưới để tạo mật khẩu mới (liên kết hết hạn sau 30 phút):",
            "Đặt lại mật khẩu",
            link,
            "Nếu nút không hoạt động, sao chép liên kết này vào trình duyệt:",
            "Nếu bạn không yêu cầu, hãy bỏ qua email này — mật khẩu của bạn vẫn an toàn.");

        return SendAsync(toEmail, "Đặt lại mật khẩu — SirLocked", body);
    }

    private static string BuildEmail(string fullName, string intro, string buttonText, string link, string fallbackNote, string footer) => $@"
        <div style='font-family:Georgia,""Times New Roman"",serif;max-width:520px;margin:auto;background:#10141b;color:#efe7d2;padding:36px;border-radius:14px;border:1px solid #2a3340'>
            <div style='text-align:center;margin-bottom:8px'>
                <span style='font-size:26px;letter-spacing:4px;color:#efe7d2;font-weight:bold'>SIR <span style='color:#d8ae52'>LOCKED</span></span>
            </div>
            <div style='height:1px;background:linear-gradient(90deg,transparent,#d8ae52,transparent);margin:18px 0 26px'></div>
            <p style='font-size:15px'>Chào <b style='color:#d8ae52'>{WebUtility.HtmlEncode(fullName)}</b>,</p>
            <p style='font-size:14px;line-height:1.6;color:#cfc7b2'>{intro}</p>
            <div style='text-align:center;margin:28px 0'>
                <a href='{link}' style='display:inline-block;background:linear-gradient(180deg,#e9c96a,#c79a3c);color:#1a1206;text-decoration:none;font-weight:bold;font-size:15px;padding:14px 38px;border-radius:8px'>{buttonText}</a>
            </div>
            <p style='font-size:12px;color:#8899aa;margin-bottom:4px'>{fallbackNote}</p>
            <p style='font-size:12px;word-break:break-all'><a href='{link}' style='color:#d8ae52'>{link}</a></p>
            <div style='height:1px;background:#2a3340;margin:24px 0 14px'></div>
            <p style='font-size:11px;color:#667'>{footer}</p>
        </div>";

    private async Task SendAsync(string toEmail, string subject, string htmlBody)
    {
        if (string.IsNullOrWhiteSpace(_settings.Username) || string.IsNullOrWhiteSpace(_settings.Password))
        {
            _logger.LogError("Email delivery is not configured. To: {To}, Subject: {Subject}", toEmail, subject);
            throw ApiException.BadGateway("Email delivery is not configured.");
        }

        using var message = new MailMessage
        {
            From = new MailAddress(_settings.SenderEmail, _settings.SenderName),
            Subject = subject,
            Body = htmlBody,
            IsBodyHtml = true
        };
        message.To.Add(toEmail);

        using var client = new SmtpClient(_settings.SmtpHost, _settings.SmtpPort)
        {
            EnableSsl = true,
            Credentials = new NetworkCredential(_settings.Username, _settings.Password)
        };

        await client.SendMailAsync(message);
        _logger.LogInformation("Email sent to {To}: {Subject}", toEmail, subject);
    }
}
