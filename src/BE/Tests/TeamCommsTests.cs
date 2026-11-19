using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.TeamComms;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

/// <summary>Chat and voice between the two detectives: who may use them, what passes, and how the relay is set up.</summary>
public sealed class TeamCommsTests
{
    private static GameRoom Room(string status = RoomStatus.InProgress, string? mode = null) => new()
    {
        Id = "6650f1f1f1f1f1f1f1f1f1f1",
        Status = status,
        Mode = mode,
        Players = [new RoomPlayer { UserId = "sherlock", Username = "Sherlock", Role = "INTERROGATOR" }, new RoomPlayer { UserId = "watson", Username = "Watson", Role = "INVESTIGATOR" }],
    };

    // ------------------------------------------------------------------ who may talk

    [Fact]
    public void OnlyTheDetectivesOfARunningTwoPlayerMatchCanTalk()
    {
        Assert.True(TeamCommsRules.CanTalk(Room(), "sherlock"));
        Assert.True(TeamCommsRules.CanTalk(Room(), "watson"));
        Assert.False(TeamCommsRules.CanTalk(Room(), "outsider"));
        Assert.False(TeamCommsRules.CanTalk(Room(), null));
        Assert.False(TeamCommsRules.CanTalk(null, "sherlock"));
        foreach (var status in new[] { RoomStatus.Waiting, RoomStatus.Ready, RoomStatus.Completed, RoomStatus.Abandoned })
            Assert.False(TeamCommsRules.CanTalk(Room(status), "sherlock"));
        // The solo tutorial has nobody to talk to.
        Assert.False(TeamCommsRules.CanTalk(Room(mode: TutorialRules.RoomMode), "sherlock"));
    }

    // ------------------------------------------------------------------ chat text

    [Theory]
    [InlineData("  Ở đây!  ", "Ở đây!")]
    [InlineData("dòng 1\r\ndòng 2", "dòng 1\ndòng 2")]
    [InlineData("a\n\n\n\n\nb", "a\n\nb")]
    [InlineData("chuông\u0007 kêu\u200B", "chuông kêu")]
    [InlineData("tab\tgiữa", "tab giữa")]
    public void ChatTextIsCleanedBeforeItIsStored(string input, string expected) =>
        Assert.Equal(expected, TeamCommsRules.NormalizeText(input));

    [Theory]
    [InlineData("")]
    [InlineData("   \n\t ")]
    [InlineData("\u200B\u0007")]
    public void NothingLeftMeansNothingToSend(string input)
    {
        Assert.Null(TeamCommsRules.NormalizeText(input));
        Assert.Null(TeamCommsRules.NormalizeText(null));
    }

    [Fact]
    public void TheLengthLimitCountsWhatAPersonSees()
    {
        Assert.Equal(300, TeamCommsRules.MaxChatLength);
        Assert.Equal(3, TeamCommsRules.VisibleLength("🕵️‍♂️ab"));
        Assert.Equal(5, TeamCommsRules.VisibleLength("Ở đây"));
    }

    // ------------------------------------------------------------------ voice signals

    [Fact]
    public void OnlyWebRtcSetUpMessagesOfASaneSizePass()
    {
        Assert.True(TeamCommsRules.IsValidSignal(new VoiceSignalMessage { Kind = "offer", Sdp = "v=0" }));
        Assert.True(TeamCommsRules.IsValidSignal(new VoiceSignalMessage { Kind = "answer", Sdp = "v=0" }));
        Assert.True(TeamCommsRules.IsValidSignal(new VoiceSignalMessage { Kind = "candidate", Candidate = "candidate:1 1 udp 1 1.2.3.4 5 typ host", SdpMid = "0", SdpMLineIndex = 0 }));
        // The end of candidates is an empty candidate.
        Assert.True(TeamCommsRules.IsValidSignal(new VoiceSignalMessage { Kind = "candidate", Candidate = "" }));

        Assert.False(TeamCommsRules.IsValidSignal(null));
        Assert.False(TeamCommsRules.IsValidSignal(new VoiceSignalMessage { Kind = "chat", Sdp = "v=0" }));
        Assert.False(TeamCommsRules.IsValidSignal(new VoiceSignalMessage { Kind = "offer" }));
        Assert.False(TeamCommsRules.IsValidSignal(new VoiceSignalMessage { Kind = "offer", Sdp = new string('x', TeamCommsRules.MaxSdpLength + 1) }));
        Assert.False(TeamCommsRules.IsValidSignal(new VoiceSignalMessage { Kind = "candidate" }));
        Assert.False(TeamCommsRules.IsValidSignal(new VoiceSignalMessage { Kind = "candidate", Candidate = new string('x', 1025) }));
        Assert.False(TeamCommsRules.IsValidSignal(new VoiceSignalMessage { Kind = "candidate", Candidate = "c", SdpMLineIndex = 99 }));
        Assert.False(TeamCommsRules.IsValidSignal(new VoiceSignalMessage { Kind = "candidate", Candidate = "c", SdpMid = new string('m', 65) }));
    }

    // ------------------------------------------------------------------ rate limits

    [Fact]
    public void ChatAllowsSixLinesInTenSecondsAndNotTwoAtOnce()
    {
        var limiter = SlidingWindowLimiter.ForChat();
        var start = new DateTime(2026, 11, 19, 8, 0, 0, DateTimeKind.Utc);
        Assert.True(limiter.TryAcquire("room:sherlock", start));
        Assert.False(limiter.TryAcquire("room:sherlock", start.AddMilliseconds(200)));
        for (var i = 1; i < 6; i++) Assert.True(limiter.TryAcquire("room:sherlock", start.AddSeconds(i)));
        Assert.False(limiter.TryAcquire("room:sherlock", start.AddSeconds(7)));
        // The partner has a budget of their own.
        Assert.True(limiter.TryAcquire("room:watson", start.AddSeconds(7)));
        // Ten seconds after the first line, one slot is free again.
        Assert.True(limiter.TryAcquire("room:sherlock", start.AddSeconds(10)));
    }

    [Fact]
    public void ConcurrentSendsShareOneBudget()
    {
        var limiter = new SlidingWindowLimiter(5, TimeSpan.FromSeconds(10));
        var now = DateTime.UtcNow;
        var accepted = 0;
        Parallel.For(0, 50, _ => { if (limiter.TryAcquire("k", now)) Interlocked.Increment(ref accepted); });
        Assert.Equal(5, accepted);
    }

    // ------------------------------------------------------------------ voice channel

    [Fact]
    public void JoiningVoiceTellsWhoIsAlreadyThere()
    {
        var voice = new VoiceRoomRegistry();
        var (first, _) = voice.Join("room", "sherlock", "c1", micOn: false);
        Assert.Empty(first);
        var (second, replaced) = voice.Join("room", "watson", "c2", micOn: true);
        Assert.Null(replaced);
        var other = Assert.Single(second);
        Assert.Equal(("sherlock", false), (other.UserId, other.MicOn));
        Assert.Equal("c2", voice.Find("room", "watson")!.ConnectionId);
        Assert.Null(voice.Find("other-room", "watson"));
    }

    [Fact]
    public void ASecondTabTakesVoiceOverAndTheOldTabCannotCloseIt()
    {
        var voice = new VoiceRoomRegistry();
        voice.Join("room", "sherlock", "old-tab", micOn: true);
        var (_, replaced) = voice.Join("room", "sherlock", "new-tab", micOn: false);
        Assert.Equal("old-tab", replaced!.ConnectionId);
        // The old tab's disconnect arriving late must not end the new tab's voice.
        Assert.False(voice.Leave("room", "sherlock", "old-tab"));
        Assert.Empty(voice.LeaveAll("old-tab"));
        Assert.Null(voice.SetMic("room", "sherlock", "old-tab", true));
        Assert.Equal("new-tab", voice.Find("room", "sherlock")!.ConnectionId);
        // Joining again from the same tab (after a reconnect) is not a takeover.
        Assert.Null(voice.Join("room", "sherlock", "new-tab", micOn: true).Replaced);
    }

    [Fact]
    public void MicChangesAndLeavingBelongToTheOwningConnection()
    {
        var voice = new VoiceRoomRegistry();
        voice.Join("room", "watson", "c2", micOn: false);
        Assert.True(voice.SetMic("room", "watson", "c2", true)!.MicOn);
        Assert.True(voice.Find("room", "watson")!.MicOn);
        Assert.True(voice.Leave("room", "watson", "c2"));
        Assert.Null(voice.Find("room", "watson"));
        Assert.False(voice.Leave("room", "watson", "c2"));
    }

    [Fact]
    public void AClosedConnectionLeavesEveryVoiceChannelItHeld()
    {
        var voice = new VoiceRoomRegistry();
        voice.Join("room-a", "sherlock", "c1", micOn: true);
        voice.Join("room-b", "sherlock", "c1", micOn: false);
        voice.Join("room-a", "watson", "c2", micOn: true);
        var left = voice.LeaveAll("c1").OrderBy(entry => entry.RoomId).ToList();
        Assert.Equal([("room-a", "sherlock"), ("room-b", "sherlock")], left);
        Assert.NotNull(voice.Find("room-a", "watson"));
        Assert.Null(voice.Find("room-b", "sherlock"));
    }

    // ------------------------------------------------------------------ STUN / TURN

    [Fact]
    public async Task WithoutARelayConfiguredPlayersGetFreeStunOnly()
    {
        var config = await Provider(new VoiceSettings()).ForUserAsync("sherlock", CancellationToken.None);
        var stun = Assert.Single(config.IceServers);
        Assert.All(stun.Urls, url => Assert.StartsWith("stun:", url));
        Assert.Null(stun.Username);
        Assert.False(config.HasRelay);
        Assert.False(config.RelayOnly);
    }

    [Fact]
    public void CoturnCredentialsFollowTheTurnRestApi()
    {
        var server = IceServerProvider.CoturnCredentials(["turn:turn.example.test:3478"], "s3cret", "user-1", DateTimeOffset.FromUnixTimeSeconds(1_700_000_000));
        Assert.Equal("1700000000:user-1", server.Username);
        // HMAC-SHA1("s3cret", "1700000000:user-1") in base64, as coturn computes it.
        Assert.Equal("DguHZgq8cz4CRa8QBLQ+gAP3OhI=", server.Credential);
    }

    [Fact]
    public async Task ACoturnRelayIsHandedOutWithCredentialsThatExpire()
    {
        var time = new FixedTime(DateTimeOffset.FromUnixTimeSeconds(1_700_000_000));
        var settings = new VoiceSettings { TurnUrls = ["turn:turn.example.test:3478?transport=udp", " "], TurnSharedSecret = "s3cret", CredentialLifetimeMinutes = 60, RelayOnly = true };
        var config = await Provider(settings, time: time).ForUserAsync("user-1", CancellationToken.None);
        Assert.True(config.HasRelay);
        Assert.True(config.RelayOnly);
        var relay = config.IceServers[^1];
        Assert.Equal(["turn:turn.example.test:3478?transport=udp"], relay.Urls);
        Assert.Equal($"{1_700_000_000 + 3600}:user-1", relay.Username);
    }

    [Fact]
    public async Task CloudflareRelaysAreAskedForWithTheKeyAndPort53IsDropped()
    {
        HttpRequestMessage? sent = null;
        string? body = null;
        var handler = new StubHandler(async request =>
        {
            sent = request;
            body = await request.Content!.ReadAsStringAsync();
            return Json(HttpStatusCode.Created, """
                {"iceServers":[
                  {"urls":["stun:stun.cloudflare.com:3478","stun:stun.cloudflare.com:53"]},
                  {"urls":["turn:turn.cloudflare.com:3478?transport=udp","turn:turn.cloudflare.com:53?transport=udp","turn:turn.cloudflare.com:80?transport=tcp","turns:turn.cloudflare.com:443?transport=tcp"],
                   "username":"cf-user","credential":"cf-pass"}]}
                """);
        });
        var settings = new VoiceSettings { CloudflareTurnKeyId = "key id", CloudflareTurnApiToken = "token", CredentialLifetimeMinutes = 120 };
        var config = await Provider(settings, handler).ForUserAsync("sherlock", CancellationToken.None);

        Assert.Equal(HttpMethod.Post, sent!.Method);
        Assert.Equal("https://rtc.live.cloudflare.com/v1/turn/keys/key%20id/credentials/generate-ice-servers", sent.RequestUri!.AbsoluteUri);
        Assert.Equal("Bearer token", sent.Headers.Authorization!.ToString());
        Assert.Equal(7200, JsonDocument.Parse(body!).RootElement.GetProperty("ttl").GetInt32());
        Assert.True(config.HasRelay);
        Assert.Equal(2, config.IceServers.Count);
        var relay = config.IceServers[1];
        Assert.Equal(["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:80?transport=tcp", "turns:turn.cloudflare.com:443?transport=tcp"], relay.Urls);
        Assert.Equal(("cf-user", "cf-pass"), (relay.Username, relay.Credential));
    }

    [Fact]
    public async Task WhenCloudflareFailsCoturnTakesOverAndOtherwiseStunStays()
    {
        var failing = new StubHandler(_ => Task.FromResult(Json(HttpStatusCode.Unauthorized, """{"error":"bad token"}""")));
        var withCoturn = new VoiceSettings { CloudflareTurnKeyId = "k", CloudflareTurnApiToken = "t", TurnUrls = ["turn:own.example.test:3478"], TurnSharedSecret = "s" };
        var config = await Provider(withCoturn, failing).ForUserAsync("watson", CancellationToken.None);
        Assert.True(config.HasRelay);
        Assert.Equal(["turn:own.example.test:3478"], config.IceServers[^1].Urls);

        var timeout = new StubHandler(_ => throw new TaskCanceledException("timed out"));
        var cloudflareOnly = new VoiceSettings { CloudflareTurnKeyId = "k", CloudflareTurnApiToken = "t", RelayOnly = true };
        var fallback = await Provider(cloudflareOnly, timeout).ForUserAsync("watson", CancellationToken.None);
        Assert.False(fallback.HasRelay);
        // Relay-only without a relay would leave the players with no way to connect.
        Assert.False(fallback.RelayOnly);
        Assert.Single(fallback.IceServers);
    }

    [Fact]
    public void ACloudflareAnswerWithoutTurnGivesNoRelay()
    {
        Assert.Empty(IceServerProvider.ParseCloudflareRelays(JsonDocument.Parse("""{"iceServers":[{"urls":["stun:stun.cloudflare.com:3478"]}]}""").RootElement));
        Assert.Empty(IceServerProvider.ParseCloudflareRelays(JsonDocument.Parse("""{"other":1}""").RootElement));
        var single = IceServerProvider.ParseCloudflareRelays(JsonDocument.Parse("""{"iceServers":{"urls":"turn:t.example:3478","username":"u","credential":"p"}}""").RootElement);
        Assert.Equal(["turn:t.example:3478"], Assert.Single(single).Urls);
    }

    private static IceServerProvider Provider(VoiceSettings settings, HttpMessageHandler? handler = null, TimeProvider? time = null) =>
        new(new HttpClient(handler ?? new StubHandler(_ => throw new InvalidOperationException("No call expected."))),
            Options.Create(settings), time ?? TimeProvider.System, NullLogger<IceServerProvider>.Instance);

    private static HttpResponseMessage Json(HttpStatusCode status, string json) =>
        new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    private sealed class StubHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => respond(request);
    }

    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
