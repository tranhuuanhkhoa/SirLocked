# SirLocked

SirLocked is a React + ASP.NET Core + MongoDB + SignalR detective game.

## Local configuration

Do not commit real secrets to `src/BE/appsettings.json`. Keep only safe local defaults or placeholders in tracked config files.

For local development, prefer ASP.NET Core User Secrets from `src/BE`:

```powershell
dotnet user-secrets set "MongoDb:ConnectionString" "mongodb+srv://<user>:<password>@<cluster>/"
dotnet user-secrets set "Jwt:Secret" "<at-least-32-character-local-secret>"
dotnet user-secrets set "AI:DeepseekApiKey" "<deepseek-api-key>"
dotnet user-secrets set "AI:ChatGptApiKey" "<chatgpt-api-key>"
dotnet user-secrets set "AI:GeminiApiKey" "<gemini-api-key>"
dotnet user-secrets set "Cloudinary:CloudName" "<cloud-name>"
dotnet user-secrets set "Cloudinary:ApiKey" "<api-key>"
dotnet user-secrets set "Cloudinary:ApiSecret" "<api-secret>"
```

Equivalent environment variables also work:

```powershell
$env:MongoDb__ConnectionString="mongodb+srv://<user>:<password>@<cluster>/"
$env:Jwt__Secret="<at-least-32-character-local-secret>"
$env:AI__DeepseekApiKey="<deepseek-api-key>"
$env:Cloudinary__ApiSecret="<api-secret>"
```

Public registration always creates `PLAYER` accounts. Admin privileges must not be granted by client registration payloads.
