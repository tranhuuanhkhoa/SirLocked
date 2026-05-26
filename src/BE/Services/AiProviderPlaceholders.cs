namespace SirLocked.API.Services;

public interface IDeepseekService;
public interface IGeminiService;
public interface IChatGptImageService;
public interface ICloudinaryService;

public sealed class DeepseekService : IDeepseekService;
public sealed class GeminiService : IGeminiService;
public sealed class ChatGptImageService : IChatGptImageService;
public sealed class CloudinaryService : ICloudinaryService;
