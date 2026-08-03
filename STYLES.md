# STYLES.md — ToshMarketplace Design Extension

This extension follows `../STYLES.md` and applies to the web catalog and the pending Swift marketplace client.

## Product Expression

- The marketplace is black and white first: black canvas and masthead, white primary text and logos, charcoal surfaces, and white separators.
- A warm coral accent marks primary actions and selected host tiles. Success, warning, and danger colors remain small semantic indicators, never decorative gradients.
- Host filtering is an app switcher, not a dropdown. Each host is represented by a selectable logo-only tile; accessible names remain available to assistive technology, visible host-name copy is omitted, and placeholder initials are acceptable until host logo assets exist. Multiple tiles may be selected.
- Product cards use a stable vertical composition: product logo on the left, publisher/title on the right, `Check out` and truthful `Get` actions below the title, four equal preview placeholders, and a compact footer.
- Cards do not expose component IDs, bridge IDs, package formats, artifact values, signing material, or runtime data.

## Platform Parity

The Swift marketplace client must reuse the same hierarchy and vocabulary when its implementation begins. It may use native controls and materials, but it must preserve the monochrome palette, host-logo app switcher, product-logo-led card identity, four-preview rhythm, and concise footer.
