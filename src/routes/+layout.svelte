<script lang="ts">
  import "../app.css";
  import { page } from "$app/state";
  let { children } = $props();

  const links: { href: string; label: string; match: (path: string) => boolean }[] = [
    { href: "/", label: "Vaults", match: (p) => p === "/" || p.startsWith("/vault") },
    { href: "/deployments", label: "Deployments", match: (p) => p.startsWith("/deployments") },
  ];
</script>

<header class="border-b border-zinc-900 bg-zinc-950/80 backdrop-blur">
  <nav class="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3 sm:px-6 lg:px-8">
    <a href="/" class="text-sm font-semibold tracking-tight text-zinc-100">Vault Tracker</a>
    <ul class="flex items-center gap-1 text-sm">
      {#each links as link (link.href)}
        {@const active = link.match(page.url.pathname)}
        <li>
          <a
            href={link.href}
            class="rounded-md px-3 py-1.5 transition {active
              ? 'bg-zinc-800 text-zinc-100'
              : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100'}"
          >
            {link.label}
          </a>
        </li>
      {/each}
    </ul>
  </nav>
</header>

{@render children()}
