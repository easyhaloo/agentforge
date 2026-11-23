// GitHub's non-Unicode aliases from GET /emojis. Unicode aliases come from gemoji.
export const githubEmojiNames = [
  "accessibility", "atom", "basecamp", "basecampy", "bowtie", "copilot", "dependabot", "electron",
  "feelsgood", "finnadie", "fishsticks", "goberserk", "godmode", "hurtrealbad", "neckbeard", "octocat",
  "rage1", "rage2", "rage3", "rage4", "shipit", "suspect", "trollface",
] as const;

const aliases = new Set<string>(githubEmojiNames);

export function githubEmojiURL(name: string) {
  if (aliases.has(name)) return `https://github.githubassets.com/images/icons/emoji/${name}.png?v8`;
}
