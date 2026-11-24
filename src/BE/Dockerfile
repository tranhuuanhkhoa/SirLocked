FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src
COPY src/BE/SirLocked.Api.csproj src/BE/
RUN dotnet restore src/BE/SirLocked.Api.csproj
COPY src/BE/ src/BE/
COPY ai-game-docs/visual-style-templates/pixellab/templates.json ai-game-docs/visual-style-templates/pixellab/templates.json
RUN dotnet publish src/BE/SirLocked.Api.csproj -c Release -o /out --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:9.0
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 appuser \
    && mkdir -p /app/keys \
    && chown -R appuser:appuser /app
COPY --from=build --chown=appuser:appuser /out/ .
ENV ASPNETCORE_URLS=http://+:8080 DataProtection__KeysPath=/app/keys
EXPOSE 8080
USER appuser
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 CMD curl -fsS http://127.0.0.1:8080/live || exit 1
ENTRYPOINT ["dotnet", "SirLocked.Api.dll"]
