using System.Security.Claims;
using System.Text;
using System.Threading.RateLimiting;
using System.Net;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.Services.Projection;
using SirLocked.Api.WebAPI;
using SirLocked.Api.WebAPI.Extensions;
using SirLocked.Api.WebAPI.Hubs;
using SirLocked.Api.WebAPI.Middlewares;

// Load repo-root .env (Section__Key format) so local config works out of the box.
EnvFileLoader.LoadFromRepoRoot(Directory.GetCurrentDirectory());

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    foreach (var value in builder.Configuration.GetSection("TrustedProxies").Get<string[]>() ?? [])
    {
        if (IPAddress.TryParse(value, out var address)) options.KnownProxies.Add(address);
    }
});

// Force the static budget audit during startup so a newly-added preset cannot run
// without an explicit, internally consistent semantic budget.
_ = CrackGenerationBudgets.All;
ProjectionCapacityPolicy.EnsureAllContractsValid();

builder.Services.Configure<MongoDbSettings>(builder.Configuration.GetSection("MongoDb"));
builder.Services.Configure<GoogleSettings>(builder.Configuration.GetSection("Google"));
builder.Services.AddOptions<EmailSettings>()
    .Bind(builder.Configuration.GetSection("Email"))
    .Validate(settings => Uri.TryCreate(settings.FrontendUrl, UriKind.Absolute, out var uri)
                          && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps)
                          && string.IsNullOrEmpty(uri.UserInfo)
                          && string.IsNullOrEmpty(uri.Query)
                          && string.IsNullOrEmpty(uri.Fragment),
        "Email__FrontendUrl must be an absolute HTTP or HTTPS URL.")
    .Validate(settings => builder.Environment.IsDevelopment()
                          || (!string.IsNullOrWhiteSpace(settings.SmtpHost)
                              && settings.SmtpPort is > 0 and < 65536
                              && !string.IsNullOrWhiteSpace(settings.SenderEmail)
                              && !string.IsNullOrWhiteSpace(settings.Username)
                              && !string.IsNullOrWhiteSpace(settings.Password)),
        "Production requires SMTP host, port, sender, username and password.")
    .ValidateOnStart();
builder.Services.AddOptions<JwtSettings>()
    .Bind(builder.Configuration.GetSection("Jwt"))
    .Validate(
        settings => JwtSettings.IsSecretValid(settings.Secret),
        "Jwt__Secret must be configured and at least 32 characters long.")
    .ValidateOnStart();
builder.Services.Configure<OpenAiSettings>(builder.Configuration.GetSection("OpenAI"));
builder.Services.Configure<CaseCacheSettings>(builder.Configuration.GetSection("CaseCache"));
builder.Services.Configure<GameplayV3Settings>(builder.Configuration.GetSection("GameplayV3"));
builder.Services.Configure<PlaytestSettings>(builder.Configuration.GetSection("Playtest"));
builder.Services.Configure<AccusationSettings>(builder.Configuration.GetSection("Accusation"));
// Resolved here rather than bound from configuration so the Development-only guard sits next to the
// admin-seed guard below, where anyone auditing startup can see both bypasses in one place.
builder.Services.Configure<AuthSettings>(settings =>
    settings.AutoVerifyRegistrations =
        AuthSettings.ResolveAutoVerifyRegistrations(builder.Configuration, builder.Environment));
builder.Services.Configure<AiCaseV3PresetSettings>(builder.Configuration.GetSection("AiCaseV3Preset"));
builder.Services.PostConfigure<OpenAiSettings>(settings =>
{
    static bool EnvFlag(IConfiguration configuration, string key) =>
        bool.TryParse(configuration[key], out var enabled) && enabled;

    if (string.IsNullOrWhiteSpace(settings.ApiKey))
    {
        var fallbackKeys = new[]
        {
            builder.Configuration["OpenAI:ApiKey"],
            builder.Configuration["OPENAI_API_KEY"],
            builder.Configuration["AI:ChatGptApiKey"]
        };
        settings.ApiKey = fallbackKeys.FirstOrDefault(key => !string.IsNullOrWhiteSpace(key)) ?? string.Empty;
    }

    settings.AiDryRun |= EnvFlag(builder.Configuration, "AI_DRY_RUN");
    settings.MockAiResponses |= EnvFlag(builder.Configuration, "MOCK_AI_RESPONSES");
    settings.SkipAssetGeneration |= EnvFlag(builder.Configuration, "SKIP_ASSET_GENERATION");
    settings.DisableAutoPublish |= EnvFlag(builder.Configuration, "DISABLE_AUTO_PUBLISH");
    settings.GenerateJsonOnly |= EnvFlag(builder.Configuration, "GENERATE_JSON_ONLY");
    settings.ValidateOnly |= EnvFlag(builder.Configuration, "VALIDATE_ONLY");
});
builder.Services.Configure<CloudinarySettings>(builder.Configuration.GetSection("Cloudinary"));
builder.Services.Configure<AiQuotaSettings>(builder.Configuration.GetSection("AiQuota"));

builder.Services.AddSingleton<MongoDbContext>();
builder.Services.AddMemoryCache();
builder.Services.AddSingleton<CaseCache>();
builder.Services.AddSingleton<FrontendRedirects>();
builder.Services.AddSingleton(TimeProvider.System);

builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<IEmailService, EmailService>();
builder.Services.AddScoped<ICaseValidationService, CaseValidationService>();
builder.Services.AddScoped<ICaseTruthService, CaseTruthService>();
builder.Services.AddScoped<IProjectionReadinessAnalyzer, ProjectionReadinessAnalyzer>();
builder.Services.AddScoped<IGameplayProjectionPlanner, GameplayProjectionPlanner>();
builder.Services.AddScoped<IProjectionContentSchemaFactory, ProjectionContentSchemaFactory>();
builder.Services.AddScoped<IGameCaseProjectionCompiler, GameCaseProjectionCompiler>();
builder.Services.AddScoped<IProjectionGraphValidator, ProjectionGraphValidator>();
builder.Services.AddScoped<ICaseService, CaseService>();
builder.Services.AddScoped<IRoomService, RoomService>();
builder.Services.AddScoped<IGameStateBuilder, GameStateBuilder>();
builder.Services.AddScoped<IGameplayContextLoader, GameplayContextLoader>();
builder.Services.AddScoped<IGameplayStatePersistence, GameplayStatePersistence>();
// One instance per request serves both roles: the consensus coordinator resolves a case through the
// very same service that owns the unilateral route.
builder.Services.AddScoped<GameplayService>();
builder.Services.AddScoped<IGameplayService>(services => services.GetRequiredService<GameplayService>());
builder.Services.AddScoped<IAccusationResolver>(services => services.GetRequiredService<GameplayService>());
builder.Services.AddScoped<IPairedConfrontationCoordinator, PairedConfrontationCoordinator>();
builder.Services.AddScoped<IAccusationConsensusCoordinator, AccusationConsensusCoordinator>();
var generatedDevelopmentPseudonymKey = false;
builder.Services.AddSingleton<IPlaytestEventSink, NoOpPlaytestEventSink>();
builder.Services.AddScoped<PlaytestSummaryService>();
builder.Services.AddScoped<IAdminService, AdminService>();
builder.Services.AddScoped<IGameNotifier, GameNotifier>();
builder.Services.AddScoped<IEvidencePhotoService, EvidencePhotoService>();
builder.Services.AddScoped<IGameResultStore, MongoGameResultStore>();
builder.Services.AddScoped<IWorkshopService, WorkshopService>();
builder.Services.AddScoped<IReviewService, ReviewService>();
builder.Services.AddScoped<IProfileService, ProfileService>();
builder.Services.AddScoped<ILeaderboardService, LeaderboardService>();
builder.Services.AddScoped<IBadgeService, BadgeService>();
builder.Services.AddScoped<IWeeklyService, WeeklyService>();

builder.Services.AddRateLimiter(options =>
{
    // 5 lần login / 1 phút / 1 IP
    options.AddPolicy("login", context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 5,
            Window = TimeSpan.FromMinutes(1),
            QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
            QueueLimit = 0
        }));

    // 3 lần đăng ký / 5 phút / 1 IP — chống tạo tài khoản rác
    options.AddPolicy("register", context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 3,
            Window = TimeSpan.FromMinutes(5),
            QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
            QueueLimit = 0
        }));

    // 3 lần gửi mail (forgot/resend) / 5 phút / 1 IP — chống dội bom email
    options.AddPolicy("email", context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 3,
            Window = TimeSpan.FromMinutes(5),
            QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
            QueueLimit = 0
        }));

    // Telemetry là ghi thật vào Mongo; UI chỉ phát vài sự kiện mỗi phút nên cửa sổ theo từng người
    // dùng đủ rộng cho luồng hợp lệ mà không cho một client lặp vô hạn thổi phồng collection.
    options.AddPolicy("playtest-events", context => RateLimitPartition.GetFixedWindowLimiter(
        context.User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? context.Connection.RemoteIpAddress?.ToString()
            ?? "anonymous",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 120,
            Window = TimeSpan.FromMinutes(1),
            QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
            QueueLimit = 0
        }));

    // Trả về 429 với message rõ ràng
    options.OnRejected = async (context, token) =>
    {
        context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        context.HttpContext.Response.ContentType = "application/json";
        await context.HttpContext.Response.WriteAsync(
            "{\"success\":false,\"message\":\"Too many attempts. Please wait 1 minute and try again.\"}",
            token);
    };
});

builder.Services.AddControllers()
    .ConfigureApiBehaviorOptions(options =>
    {
        options.InvalidModelStateResponseFactory = ApiValidationResponseFactory.Create;
    });
builder.Services.AddSignalR();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo { Title = "SirLocked API", Version = "v1" });
    options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Description = "JWT Authorization header. Example: \"Bearer {token}\"",
        Name = "Authorization",
        In = ParameterLocation.Header,
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT"
    });
    options.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" }
            },
            Array.Empty<string>()
        }
    });
});

builder.Services.AddCors(options =>
{
    var settings = builder.Configuration.GetSection("Cors").Get<CorsSettings>() ?? new CorsSettings();
    var allowedOrigins = settings.AllowedOrigins
        .Where(origin => !string.IsNullOrWhiteSpace(origin))
        .Select(origin => origin.Trim().TrimEnd('/'))
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .ToArray();
    if (allowedOrigins.Length == 0 || allowedOrigins.Any(origin =>
            !Uri.TryCreate(origin, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
            || !string.IsNullOrEmpty(uri.UserInfo)
            || uri.AbsolutePath != "/"
            || !string.IsNullOrEmpty(uri.Query)
            || !string.IsNullOrEmpty(uri.Fragment)))
    {
        throw new InvalidOperationException("Cors__AllowedOrigins must contain valid absolute HTTP or HTTPS origins.");
    }

    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins(allowedOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});

var googleSettings = builder.Configuration.GetSection("Google").Get<GoogleSettings>() ?? new GoogleSettings();

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddCookie("External")
    .AddGoogle(options =>
    {
        options.ClientId = googleSettings.ClientId;
        options.ClientSecret = googleSettings.ClientSecret;
        options.CallbackPath = "/signin-google";
        options.SignInScheme = "External";
        options.SaveTokens = true;
    })
    .AddJwtBearer();

builder.Services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
    .Configure<IOptions<JwtSettings>>((options, configuredJwt) =>
    {
        var jwtSettings = configuredJwt.Value;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtSettings.Issuer,
            ValidAudience = jwtSettings.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSettings.Secret)),
            ClockSkew = TimeSpan.FromMinutes(1)
        };

        // SignalR browser clients send the JWT as ?access_token=...
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                var path = context.HttpContext.Request.Path;
                if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/hubs"))
                {
                    context.Token = accessToken;
                }
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization();
builder.Services.AddHealthChecks()
    .AddCheck<MongoDbHealthCheck>("mongodb", tags: new[] { "ready" });

var app = builder.Build();

app.UseMiddleware<CorrelationIdMiddleware>();
app.UseMiddleware<ErrorHandlingMiddleware>();
app.UseForwardedHeaders();
app.UseRateLimiter();

if (app.Environment.IsDevelopment() || app.Configuration.GetValue<bool>("Swagger:Enabled"))
{
    app.UseSwagger();
    app.UseSwaggerUI(options => options.SwaggerEndpoint("/swagger/v1/swagger.json", "SirLocked API v1"));
}

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.UseMiddleware<UserStatusMiddleware>();

app.MapControllers();
app.MapHub<GameHub>("/hubs/game");
app.MapHealthChecks("/health");
app.MapGet("/live", () => Results.Ok(new { status = "ok" }));

// Startup tasks: indexes + admin seed. A production process must not advertise a
// healthy API while Mongo/index bootstrap is unavailable. Development keeps the
// historical degraded-start option; production can opt in explicitly with
// MongoDb__AllowDegradedStartup only for a controlled maintenance scenario.
using (var scope = app.Services.CreateScope())
{
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
    if (generatedDevelopmentPseudonymKey)
    {
        logger.LogWarning(
            "Playtest__PseudonymKey is not configured; a per-process random key was generated. Playtest pseudonyms will not line up across restarts.");
    }
    try
    {
        var db = scope.ServiceProvider.GetRequiredService<MongoDbContext>();
        await db.PingAsync();
        await db.EnsureIndexesAsync();
        var seedOptions = ResolveAdminSeedOptions(app.Configuration, app.Environment);
        if (seedOptions is not null)
        {
            var auth = scope.ServiceProvider.GetRequiredService<IAuthService>();
            await auth.SeedAdminAsync(seedOptions);
        }
        else
        {
            logger.LogInformation("Default admin seeding is disabled for environment {Environment}.", app.Environment.EnvironmentName);
        }
        logger.LogInformation("MongoDB connected ({Database}); indexes ensured; admin seed policy applied.", db.Settings.DatabaseName);
    }
    catch (GameResultIndexInvariantException ex)
    {
        logger.LogCritical(
            ex,
            "GameResult RoomId uniqueness could not be guaranteed; API startup is aborted. Resolve the reported index or duplicate identifiers explicitly.");
        throw;
    }
    catch (OperationCanceledException)
    {
        throw;
    }
    catch (Exception ex)
    {
        if (!app.Environment.IsDevelopment()
            && !app.Configuration.GetValue<bool>("MongoDb:AllowDegradedStartup"))
        {
            logger.LogCritical(ex, "MongoDB startup tasks failed; refusing to start without verified connectivity and indexes.");
            throw;
        }
        logger.LogError(ex, "MongoDB startup tasks failed in degraded development mode. Check MongoDb__ConnectionString.");
    }
}

app.Run();

static AdminSeedOptions? ResolveAdminSeedOptions(IConfiguration configuration, IHostEnvironment environment)
{
    static bool Flag(IConfiguration configuration, string key) =>
        bool.TryParse(configuration[key], out var enabled) && enabled;

    var enabled = environment.IsDevelopment()
                  || Flag(configuration, "Auth:SeedDefaultAdmin")
                  || Flag(configuration, "AUTH_SEED_DEFAULT_ADMIN");
    if (!enabled)
    {
        return null;
    }

    var email = configuration["Auth:SeedAdminEmail"] ?? AuthService.AdminEmail;
    var password = configuration["Auth:SeedAdminPassword"];
    if (string.IsNullOrWhiteSpace(password))
    {
        if (!environment.IsDevelopment())
        {
            throw new InvalidOperationException("Auth__SeedAdminPassword must be configured when Auth__SeedDefaultAdmin is enabled outside Development.");
        }
        password = AuthService.AdminDefaultPassword;
    }
    var fullName = configuration["Auth:SeedAdminFullName"] ?? "SirLocked Admin";
    return new AdminSeedOptions(email, password, fullName);
}

sealed class MongoDbHealthCheck : IHealthCheck
{
    private readonly MongoDbContext _db;

    public MongoDbHealthCheck(MongoDbContext db) => _db = db;

    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        try
        {
            await _db.PingAsync(cancellationToken);
            return HealthCheckResult.Healthy("MongoDB is reachable.");
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Unhealthy("MongoDB is unreachable.", ex);
        }
    }
}

public partial class Program;
