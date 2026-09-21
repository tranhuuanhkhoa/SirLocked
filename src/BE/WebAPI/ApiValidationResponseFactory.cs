using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;

namespace SirLocked.Api.WebAPI;

public static class ApiValidationResponseFactory
{
    public static IActionResult Create(ActionContext context)
    {
        var errors = context.ModelState
            .Where(entry => entry.Value?.Errors.Count > 0)
            .ToDictionary(
                entry => entry.Key,
                entry => entry.Value!.Errors
                    .Select(error => string.IsNullOrWhiteSpace(error.ErrorMessage)
                        ? "The supplied value is invalid."
                        : error.ErrorMessage)
                    .ToArray());
        var firstMessage = errors.Values.SelectMany(value => value).FirstOrDefault()
            ?? "Request validation failed.";
        return new BadRequestObjectResult(ApiResponse<object>.Fail(firstMessage, errors));
    }
}
