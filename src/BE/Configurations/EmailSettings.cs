namespace SirLocked.Api.Configurations;

public class EmailSettings
{
    public string SmtpHost { get; set; } = "smtp.gmail.com";
    public int SmtpPort { get; set; } = 587;
    public string SenderEmail { get; set; } = string.Empty;
    public string SenderName { get; set; } = "SirLocked";
    public string Username { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
    public string FrontendUrl { get; set; } = "http://localhost:5173";
}
