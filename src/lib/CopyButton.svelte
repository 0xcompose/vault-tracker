<script lang="ts">
  interface Props {
    value: string;
    title?: string;
  }
  let { value, title = "copy" }: Props = $props();

  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function copy(e: Event): Promise<void> {
    // Buttons live inside <a> ancestors on the vault list — stop the click
    // from triggering navigation.
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => (copied = false), 1200);
    } catch {
      // ignore — clipboard API can fail in non-secure contexts
    }
  }
</script>

<button
  type="button"
  onclick={copy}
  title={copied ? "copied" : title}
  aria-label={copied ? "copied" : title}
  class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
>
  {#if copied}
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" class="h-3 w-3">
      <path d="M3 8.5l3 3 7-7" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  {:else}
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" class="h-3 w-3">
      <rect x="5" y="5" width="8" height="8" rx="1.5" />
      <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2H4.5A1.5 1.5 0 0 0 3 3.5v6A1.5 1.5 0 0 0 4.5 11H6" />
    </svg>
  {/if}
</button>
