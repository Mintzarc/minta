// The films the splash plays (components/Splash.tsx). With more than one, each time the splash plays it shows the next one, in turn,
// so a visitor who comes back sees the other. To add one: cut its files with `brand/splash/make-assets.sh <source film> -2` (the
// suffix names the files) and add a line below.
export interface Film { src: string; poster: string }

export const FILMS: Film[] = [
  { src: '/splash/minta-splash.mp4', poster: '/splash/minta-splash-poster.webp' },
];

/** The index of the film to play after the one played last (null or garbage when none is remembered): the next one, wrapping round */
export function nextFilm(count: number, last: number | null): number {
  if (!Number.isInteger(count) || count < 2) return 0;
  if (last === null || !Number.isInteger(last) || last < 0 || last >= count) return 0;
  return (last + 1) % count;
}
