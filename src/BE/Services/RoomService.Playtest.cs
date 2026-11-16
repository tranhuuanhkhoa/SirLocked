using MongoDB.Driver;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Room;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.Services;

/// <summary>"Chơi thử" on /admin/ai: a private room of an imported, unpublished AI draft (see <see cref="PlaytestRoomRules"/>).</summary>
public partial class RoomService
{
    public const string PlaytestNotFoundMessage = "AI draft not found.";

    /// <summary>
    /// Opens (or reopens) the caller's playtest room of a draft. Only an admin or the draft's author may; the case must be
    /// imported. The room is PRIVATE and carries a single-use invite secret for the second seat.
    /// </summary>
    public async Task<RoomResponse> CreatePlaytestAsync(CurrentUser user, string draftId)
    {
        if (!MongoDB.Bson.ObjectId.TryParse(draftId, out _)) throw ApiException.NotFound(PlaytestNotFoundMessage);
        var draft = await _db.AiCaseDrafts.Find(item => item.Id == draftId).FirstOrDefaultAsync()
            ?? throw ApiException.NotFound(PlaytestNotFoundMessage);
        if (!PlaytestRoomRules.CanHost(user, draft))
            throw ApiException.Forbidden("Only an admin or the author of this draft can playtest it.",
                PlaytestRoomRules.ForbiddenCode, PlaytestRoomRules.ForbiddenMessageKey);
        if (!PlaytestRoomRules.IsPlaytestable(draft))
            throw ApiException.Conflict("This draft has not been imported as a case yet, so it cannot be playtested.",
                PlaytestRoomRules.NotImportedCode, PlaytestRoomRules.NotImportedMessageKey);
        await EnsureEmailVerifiedAsync(user);

        var gameCase = await _caseService.FindCaseAsync(draft.ImportedCaseId!)
            ?? throw ApiException.Conflict("The imported case of this draft no longer exists.",
                PlaytestRoomRules.NotImportedCode, PlaytestRoomRules.NotImportedMessageKey);
        if (!gameCase.Stages.Any(stage => stage.Scenes.Count > 0))
            throw ApiException.Conflict("The imported case has no scene to play.",
                PlaytestRoomRules.NotImportedCode, PlaytestRoomRules.NotImportedMessageKey);

        // Pressing "Chơi thử" again returns the room the caller already has open for this draft.
        var rooms = Builders<GameRoom>.Filter;
        var open = await _db.Rooms.Find(rooms.Eq(room => room.Playtest!.DraftId, draft.Id)
                & rooms.Eq(room => room.CaseId, gameCase.CaseId)
                & rooms.ElemMatch(room => room.Players, player => player.UserId == user.Id)
                & rooms.In(room => room.Status, [RoomStatus.Waiting, RoomStatus.Ready, RoomStatus.InProgress]))
            .SortByDescending(room => room.CreatedAt)
            .FirstOrDefaultAsync();
        if (open is not null) return await ToLobbyResponseAsync(open, gameCase.Title);

        var created = new GameRoom
        {
            CaseId = gameCase.CaseId,
            HostUserId = user.Id,
            Status = RoomStatus.Waiting,
            Visibility = RoomVisibility.Private,
            Players = new List<RoomPlayer> { new() { UserId = user.Id, Username = user.FullName } },
            Playtest = new RoomPlaytest
            {
                DraftId = draft.Id,
                AuthorUserId = draft.CreatedByUserId,
                CreatedByUserId = user.Id,
                InviteToken = PlaytestRoomRules.NewInviteToken()
            }
        };
        await InsertWithRoomCodeAsync(created);
        _logger?.LogInformation("Playtest room {RoomId} opened for draft {DraftId} (case {CaseId}).", created.Id, draft.Id, gameCase.CaseId);
        return await ToLobbyResponseAsync(created, gameCase.Title);
    }

    /// <summary>
    /// True when the caller sits in a playtest room of this case: such a member may read the unpublished case's
    /// public detail and approved intro cutscene, which players otherwise never see.
    /// </summary>
    public async Task<bool> IsPlaytestMemberAsync(string userId, string roomId, string caseId)
    {
        if (string.IsNullOrWhiteSpace(roomId) || !MongoDB.Bson.ObjectId.TryParse(roomId, out _)) return false;
        var room = await _db.Rooms.Find(candidate => candidate.Id == roomId)
            .Project(candidate => new GameRoom { Id = candidate.Id, CaseId = candidate.CaseId, Players = candidate.Players, Playtest = candidate.Playtest })
            .FirstOrDefaultAsync();
        return room?.Playtest is not null
            && string.Equals(room.CaseId, caseId, StringComparison.Ordinal)
            && room.Players.Any(player => player.UserId == userId);
    }
}
