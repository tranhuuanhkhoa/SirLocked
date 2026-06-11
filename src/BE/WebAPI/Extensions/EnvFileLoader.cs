namespace SirLocked.Api.WebAPI.Extensions;

/// <summary>
/// Loads a repo-root .env file (KEY=VALUE, ASP.NET "Section__Key" style) into process
/// environment variables before configuration is built, so the existing repo .env works
/// without extra tooling. Existing environment variables always win.
/// </summary>
public static class EnvFileLoader
{
    public static void LoadFromRepoRoot(string startDirectory)
    {
        var dir = new DirectoryInfo(startDirectory);
        for (var depth = 0; dir is not null && depth < 6; depth++, dir = dir.Parent)
        {
            var envPath = Path.Combine(dir.FullName, ".env");
            if (File.Exists(envPath))
            {
                Load(envPath);
                return;
            }
        }
    }

    public static void Load(string path)
    {
        foreach (var rawLine in File.ReadAllLines(path))
        {
            var line = rawLine.Trim();
            if (line.Length == 0 || line.StartsWith('#')) continue;

            var idx = line.IndexOf('=');
            if (idx <= 0) continue;

            var key = line[..idx].Trim();
            var value = line[(idx + 1)..].Trim().Trim('"');
            if (Environment.GetEnvironmentVariable(key) is null)
            {
                Environment.SetEnvironmentVariable(key, value);
            }
        }
    }
}
