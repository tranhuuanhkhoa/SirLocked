type AssetScene = { backgroundUrl?: string };
type AssetCharacter = { imageUrl?: string };

export const PLAYER_SHEETS: Record<string, { key: string; url: string }> = {
  INVESTIGATOR: { key: 'player-holmes', url: '/assets/players/holmes-sheet.png' },
  INTERROGATOR: { key: 'player-watson', url: '/assets/players/watson-sheet.png' },
};

export const PLAYER_FRAME = { width: 128, height: 192, sourceX: 0 };

export function playableAssetUrl(value: string | undefined) {
  const url = String(value ?? '').trim();
  if (!url || url === '#' || url.toLowerCase() === 'placeholder') return '';
  return url;
}

export function sceneBackgroundUrl(scene: AssetScene) {
  return playableAssetUrl(scene.backgroundUrl);
}

export function characterPortraitUrl(character: AssetCharacter) {
  return playableAssetUrl(character.imageUrl);
}

export function characterSpriteUrl(character: AssetCharacter) {
  const portrait = playableAssetUrl(character.imageUrl);
  if (!portrait || !portrait.includes('-portrait')) return '';
  return portrait.replace('-portrait', '-sprite');
}

export function sceneCharacterSpriteUrl(character: AssetCharacter, sceneId: string | undefined) {
  const portrait = playableAssetUrl(character.imageUrl);
  if (!portrait || !portrait.includes('-portrait') || !sceneId) return '';
  return portrait.replace('-portrait', `-${sceneId}-sprite`);
}
