using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.WebAPI.Extensions;
using SirLocked.Api.WebAPI.Hubs;
using SirLocked.Api.WebAPI.Middlewares;

// Load repo-root .env (Section__Key format) so local config works out of the box.
EnvFileLoader.LoadFromRepoRoot(Directory.GetCurrentDirectory());

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<MongoDbSettings>(builder.Configuration.GetSection("MongoDb"));
builder.Services.Configure<JwtSettings>(builder.Configuration.GetSection("Jwt"));
builder.Services.Configure<OpenAiSettings>(builder.Configuration.GetSection("OpenAI"));
builder.Services.PostConfigure<OpenAiSettings>(settings =>
{
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
});
builder.Services.Configure<CloudinarySettings>(builder.Configuration.GetSection("Cloudinary"));

var jwtSettings = builder.Configuration.GetSection("Jwt").Get<JwtSettings>() ?? new JwtSettings();
if (string.IsNullOrWhiteSpace(jwtSettings.Secret) || jwtSettings.Secret.Length < 32)
{
    throw new InvalidOperationException("Jwt__Secret must be configured and at least 32 characters long.");
}

builder.Services.AddSingleton<MongoDbContext>();

builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<ICaseValidationService, CaseValidationService>();
builder.Services.AddScoped<ICaseService, CaseService>();
builder.Services.AddScoped<IRoomService, RoomService>();
builder.Services.AddScoped<IGameStateBuilder, GameStateBuilder>();
builder.Services.AddScoped<IGameplayService, GameplayService>();
builder.Services.AddScoped<IAiCaseService, AiCaseService>();
builder.Services.AddScoped<IAdminService, AdminService>();
builder.Services.AddScoped<IGameNotifier, GameNotifier>();
builder.Services.AddHttpClient(AiCaseService.OpenAiHttpClientName);

builder.Services.AddControllers();
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
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins(
                "http://localhost:5173",
                "http://127.0.0.1:5173",
                "http://localhost:4173")
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
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

var app = builder.Build();

app.UseMiddleware<ErrorHandlingMiddleware>();

app.UseSwagger();
app.UseSwaggerUI(options => options.SwaggerEndpoint("/swagger/v1/swagger.json", "SirLocked API v1"));

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.UseMiddleware<UserStatusMiddleware>();

app.MapControllers();
app.MapHub<GameHub>("/hubs/game");
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

// Startup tasks: indexes + admin seed. Failures are logged but do not stop the host,
// so the app can still boot and report a clear error when MongoDB is unreachable.
using (var scope = app.Services.CreateScope())
{
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
    try
    {
        var db = scope.ServiceProvider.GetRequiredService<MongoDbContext>();
        await db.PingAsync();
        await db.EnsureIndexesAsync();
        var auth = scope.ServiceProvider.GetRequiredService<IAuthService>();
        await auth.SeedAdminAsync();
        logger.LogInformation("MongoDB connected ({Database}); indexes ensured; admin account verified.", db.Settings.DatabaseName);
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "MongoDB startup tasks failed. Check MongoDb__ConnectionString. API endpoints that need the database will fail until it is reachable.");
    }
}

app.Run();
