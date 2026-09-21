namespace SirLocked.Api.Configurations;

public class CloudinarySettings
{
    public bool Enabled { get; set; }
    public string CloudName { get; set; } = string.Empty;
    public string ApiKey { get; set; } = string.Empty;
    public string ApiSecret { get; set; } = string.Empty;
    public string Folder { get; set; } = "sirlocked/cases";
}
