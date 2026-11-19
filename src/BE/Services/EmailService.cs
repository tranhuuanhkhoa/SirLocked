using System.Net;
using System.Net.Mail;
using System.Text;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.WebAPI;

namespace SirLocked.Api.Services;

public class EmailService : IEmailService
{
    private readonly EmailSettings _settings;
    private readonly ILogger<EmailService> _logger;
    private readonly FrontendRedirects _links;

    public EmailService(IOptions<EmailSettings> settings, ILogger<EmailService> logger)
    {
        _settings = settings.Value;
        _logger = logger;
        _links = new FrontendRedirects(settings);
    }

    public Task SendVerificationEmailAsync(string toEmail, string fullName, string token)
    {
        var link = _links.VerifyEmail(token);
        var body = BuildEmail(
            fullName,
            "Cảm ơn bạn đã đăng ký SirLocked. Nhấn nút bên dưới để xác minh email và mở khóa trò chơi:",
            "Xác minh tài khoản",
            link,
            "Nếu nút không hoạt động, sao chép liên kết này vào trình duyệt:",
            "Nếu bạn không đăng ký tài khoản này, hãy bỏ qua email.");

        return SendAsync(toEmail, "Xác minh tài khoản — SirLocked", body,
            BuildPlainText(fullName, "Cảm ơn bạn đã đăng ký SirLocked. Xác minh email để mở khóa trò chơi:", link));
    }

    public Task SendPasswordResetEmailAsync(string toEmail, string fullName, string token)
    {
        var link = _links.ResetPassword(token);
        var body = BuildEmail(
            fullName,
            "Bạn đã yêu cầu đặt lại mật khẩu. Nhấn nút bên dưới để tạo mật khẩu mới (liên kết hết hạn sau 30 phút):",
            "Đặt lại mật khẩu",
            link,
            "Nếu nút không hoạt động, sao chép liên kết này vào trình duyệt:",
            "Nếu bạn không yêu cầu, hãy bỏ qua email này — mật khẩu của bạn vẫn an toàn.");

        return SendAsync(toEmail, "Đặt lại mật khẩu — SirLocked", body,
            BuildPlainText(fullName, "Bạn đã yêu cầu đặt lại mật khẩu. Liên kết hết hạn sau 30 phút:", link));
    }

    internal static string BuildEmail(string fullName, string intro, string buttonText, string link, string fallbackNote, string footer)
    {
        var safeName = WebUtility.HtmlEncode(fullName);
        var safeIntro = WebUtility.HtmlEncode(intro);
        var safeButton = WebUtility.HtmlEncode(buttonText);
        var safeLink = WebUtility.HtmlEncode(link);
        var safeFallback = WebUtility.HtmlEncode(fallbackNote);
        var safeFooter = WebUtility.HtmlEncode(footer);
        return $$"""
            <!doctype html>
            <html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
            <body style="margin:0;padding:0;background:#2a1f17;color:#07111f;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;background:#2a1f17;">
                <tr><td align="center" style="padding:32px 12px 40px;">
                  <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;border-collapse:collapse;">
                    <tr><td align="center" style="padding:0 8px 21px;color:#fbf6ed;font-family:Georgia,'Times New Roman',serif;font-size:27px;font-weight:bold;letter-spacing:3px;">SIR <span style="color:#efd486;">LOCKED</span></td></tr>
                    <tr><td align="center" style="padding:0 0 9px;color:#efd486;font-family:Arial,sans-serif;font-size:10px;letter-spacing:3px;">BẢNG PHÁ ÁN · 221B</td></tr>
                    <tr><td style="padding:0 13px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;background:#fbf6ed;border:1px solid #d2c4aa;">
                        <tr><td width="28" style="width:28px;border-right:2px solid #b64030;">&nbsp;</td><td style="padding:25px 25px 28px 20px;">
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                            <tr><td style="padding:0 0 10px;border-bottom:1px solid #b64030;color:#5b5248;font-family:Arial,sans-serif;font-size:11px;letter-spacing:2px;">ĐIỆN TÍN KHẨN</td><td align="right" style="padding:0 0 10px;border-bottom:1px solid #b64030;color:#5b5248;font-family:Arial,sans-serif;font-size:11px;letter-spacing:2px;">GỬI 221B</td></tr>
                            <tr><td colspan="2" style="padding:19px 0 0;color:#07111f;font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:bold;line-height:1.15;">{{safeButton}}</td></tr>
                            <tr><td colspan="2" style="padding:13px 0 0;color:#2a2318;font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:1.5;">Chào <strong>{{safeName}}</strong>,</td></tr>
                            <tr><td colspan="2" style="padding:10px 0 0;color:#2a2318;font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:1.55;">{{safeIntro}}</td></tr>
                            <tr><td colspan="2" style="padding:24px 0 22px;">
                              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;"><tr><td bgcolor="#9e3f2a" style="background:#9e3f2a;border-bottom:3px solid #6b2a1c;">
                                <a href="{{safeLink}}" style="display:inline-block;padding:16px 24px;color:#fffaf1;font-family:Arial,sans-serif;font-size:13px;font-weight:bold;letter-spacing:2px;text-decoration:none;">{{safeButton}} &rarr;</a>
                              </td></tr></table>
                            </td></tr>
                            <tr><td colspan="2" style="padding:15px 0 0;border-top:1px solid #d3c5ac;color:#5b5248;font-family:Arial,sans-serif;font-size:13px;line-height:1.5;">{{safeFallback}}</td></tr>
                            <tr><td colspan="2" style="padding:8px 0 0;font-family:Arial,sans-serif;font-size:13px;line-height:1.5;overflow-wrap:anywhere;word-break:break-all;"><a href="{{safeLink}}" style="color:#9e3f2a;text-decoration:underline;">{{safeLink}}</a></td></tr>
                          </table>
                        </td></tr>
                      </table>
                    </td></tr>
                    <tr><td align="center" style="padding:19px 22px 0;color:#e4d8bf;font-family:Arial,sans-serif;font-size:12px;line-height:1.5;">{{safeFooter}}</td></tr>
                  </table>
                </td></tr>
              </table>
            </body></html>
            """;
    }

    private static string BuildPlainText(string fullName, string intro, string link) =>
        $"SIR LOCKED — BẢNG PHÁ ÁN 221B\n\nChào {fullName},\n\n{intro}\n{link}\n\nNếu bạn không yêu cầu email này, hãy bỏ qua.";

    private async Task SendAsync(string toEmail, string subject, string htmlBody, string plainText)
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
            SubjectEncoding = Encoding.UTF8,
            Body = plainText,
            BodyEncoding = Encoding.UTF8,
            IsBodyHtml = false
        };
        message.To.Add(toEmail);
        message.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(htmlBody, Encoding.UTF8, "text/html"));

        using var client = new SmtpClient(_settings.SmtpHost, _settings.SmtpPort)
        {
            EnableSsl = true,
            Credentials = new NetworkCredential(_settings.Username, _settings.Password)
        };

        await client.SendMailAsync(message);
        _logger.LogInformation("Email sent to {To}: {Subject}", toEmail, subject);
    }
}
