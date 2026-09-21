using Microsoft.AspNetCore.Http;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Interfaces;

public interface IEvidencePhotoService
{
    Task<NormalizedEvidencePhoto> NormalizeAsync(IFormFile photo, CancellationToken cancellationToken = default);
    Task UpsertAsync(
        string roomId,
        string clueId,
        string sceneId,
        string userId,
        NormalizedEvidencePhoto photo,
        CancellationToken cancellationToken = default);
    Task<EvidencePhoto?> GetAsync(string roomId, string clueId, CancellationToken cancellationToken = default);
}

public sealed record NormalizedEvidencePhoto(byte[] Data, string ContentType, int Width, int Height);
