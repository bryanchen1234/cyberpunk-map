import { formatDistance, type Point } from '../services/geo-math';
import { autocomplete, MIN_QUERY_LENGTH, type Place } from '../services/geocoding';
import { searchUsage, trySearch } from '../services/search-limit';
import { QUOTA_MESSAGE, ApiError } from '../services/http';

/** How long to wait after the last keystroke before asking the server. */
const DEBOUNCE_MS = 300;

/**
 * Fullscreen search.
 *
 * Fullscreen rather than a fixed bar because on a phone the HUD is already
 * tight on space, and the results list needs room to be read at a glance
 * while driving.
 */
export class SearchOverlay {
  readonly el = document.createElement('div');
  onPick: ((place: Place) => void) | null = null;

  private input: HTMLInputElement;
  private list: HTMLElement;
  private status: HTMLElement;
  private timer: number | null = null;
  private inFlight: AbortController | null = null;

  /** @param getNear current position, used to bias the results */
  constructor(private readonly getNear: () => Point | null) {
    this.el.className = 'search';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="search__bar panel">
        <input class="search__input" type="search" enterkeyhint="search"
               autocomplete="off" autocorrect="off" spellcheck="false"
               placeholder="Where to?" aria-label="Search destination" />
        <button class="btn btn--ghost search__close">Close</button>
      </div>
      <div class="search__status label" data-status></div>
      <ul class="search__list" data-list></ul>`;

    this.input = this.el.querySelector('.search__input')!;
    this.list = this.el.querySelector('[data-list]')!;
    this.status = this.el.querySelector('[data-status]')!;

    this.el.querySelector('.search__close')!.addEventListener('click', () => this.close());
    this.input.addEventListener('input', () => this.schedule());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  }

  open() {
    this.el.hidden = false;
    // Opening always comes from pressing a button, i.e. a user gesture, which
    // is what iOS requires for focus() to bring up the keyboard.
    this.input.focus();
    this.input.select();
  }

  close() {
    this.cancelPending();
    this.el.hidden = true;
    this.input.blur();
  }

  private cancelPending() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.inFlight?.abort();
    this.inFlight = null;
  }

  private schedule() {
    this.cancelPending();
    const text = this.input.value.trim();

    if (text.length < MIN_QUERY_LENGTH) {
      this.list.replaceChildren();
      this.status.textContent = text.length ? `Type at least ${MIN_QUERY_LENGTH} letters` : '';
      return;
    }

    // A non-incrementing peek: just avoids flashing "Searching..." for a
    // request that's already known to be over budget. The real, counted
    // check is in run(), right before the network call.
    const usage = searchUsage();
    if (usage.count >= usage.limit) {
      this.list.replaceChildren();
      this.status.textContent = QUOTA_MESSAGE.toUpperCase();
      return;
    }

    this.status.textContent = 'Searching…';
    this.timer = window.setTimeout(() => void this.run(text), DEBOUNCE_MS);
  }

  private async run(text: string) {
    // The counted check: schedule()'s peek only avoided a UI flash, this is
    // what actually spends a unit of this browser's self-imposed cap, one
    // per real request.
    if (!trySearch()) {
      this.list.replaceChildren();
      this.status.textContent = QUOTA_MESSAGE.toUpperCase();
      return;
    }

    // Cancelling the previous request isn't an optimization: without it,
    // responses arrive out of order and the list flickers with results from
    // already-stale queries.
    const ctrl = new AbortController();
    this.inFlight = ctrl;

    try {
      const places = await autocomplete(text, this.getNear(), ctrl.signal);
      if (ctrl.signal.aborted) return;
      this.paint(places);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      this.list.replaceChildren();
      this.status.textContent =
        err instanceof ApiError ? err.message.toUpperCase() : 'SEARCH ERROR';
    }
  }

  private paint(places: Place[]) {
    this.list.replaceChildren();

    if (!places.length) {
      this.status.textContent = 'No results';
      return;
    }
    this.status.textContent = '';

    for (const place of places) {
      const li = document.createElement('li');
      li.className = 'search__item';

      const name = document.createElement('span');
      name.className = 'search__label';
      name.textContent = place.label;
      li.appendChild(name);

      if (place.distanceM !== null) {
        const dist = document.createElement('span');
        dist.className = 'num search__dist';
        dist.textContent = formatDistance(place.distanceM);
        li.appendChild(dist);
      }

      li.addEventListener('click', () => {
        this.close();
        this.onPick?.(place);
      });
      this.list.appendChild(li);
    }
  }
}
