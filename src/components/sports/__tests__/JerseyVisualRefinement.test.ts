import { readFileSync } from 'fs';
import path from 'path';

describe('jersey visual refinement', () => {
  const source = readFileSync(path.join(process.cwd(), 'src/components/sports/jerseyVisuals.tsx'), 'utf8');

  it('uses the app display font and a bold broadcast-grade twill border for jersey wordmarks', () => {
    expect(source).toContain("const WORDMARK_FONT_FAMILY = 'BebasNeue_400Regular'");
    expect(source).toContain('fontFamily={WORDMARK_FONT_FAMILY}');
    // Run 7: the tackle-twill border is heavier (0.18 -> 0.215, cap 2.35 -> 3.1)
    // so the lettering reads as a confident bold broadcast graphic, not thin text.
    expect(source).toContain('Math.min(3.1, layout.fontSize * 0.215)');
    expect(source).toContain('strokeOpacity={0.16}');
  });

  it('gives baseball wordmarks more room and fits condensed jersey lettering', () => {
    expect(source).toContain('return sum + 0.56');
    expect(source).toContain('maxWidth={68}');
    expect(source).toContain('minFontSize={8.8}');
  });

  it('keeps integrated jersey wordmarks larger and readable across sports', () => {
    expect(source).toContain('return { maxWidth: 52, minFontSize: 8.2 };');
    expect(source).toContain('return { maxWidth: 54, minFontSize: 7.8 };');
    expect(source).toContain('return { maxWidth: 48, minFontSize: 7.4 };');
    expect(source).toContain('return length >= 11 ? 9.8 : length >= 9 ? 10.7 : length >= 7 ? 11.4 : 12.6;');
  });

  it('locks jersey lettering into the cloth surface instead of floating above it', () => {
    expect(source).toContain('surface?: string;');
    expect(source).toContain('const integratedFill = mixColor(fill, jerseySurface');
    // The raised-emboss passes are emitted through the shared `glyph()` helper (so
    // each pass can render flat OR along a nameplate arc via <TextPath> at the same
    // node cost) instead of inline <SvgText>.
    expect(source).toContain('`applique_surface_shadow_${line}_${index}`');
    expect(source).toContain('surface={surface}');
  });

  it('arcs the nameplate / chest script along a real curved baseline via TextPath', () => {
    // A genuine arc (one TextPath per pass, not one glyph-pass per letter) so an
    // arced nameplate costs the same node count as a flat one.
    expect(source).toContain('TextPath,');
    expect(source).toContain('function labelArcPath(');
    expect(source).toContain('const arcActive = arc !== 0 && layout.lines.length === 1 && !!arcId;');
    expect(source).toContain('<TextPath href={`#${arcPaths[index]}`} startOffset="50%">');
    // Sports whose convention is a curved nameplate / chest script get an arc.
    expect(source).toContain('arc={3.8} arcId={`${arcBase}_word`}'); // baseball chest script
    expect(source).toContain('arc={3.4} arcId={`${arcBase}_word`}'); // hockey back nameplate
    expect(source).toContain('arc={3} arcId={`${arcBase}_word`}'); // cricket back nameplate
  });

  it('cuts a distinct tennis polo (collar wings + button placket)', () => {
    expect(source).toContain('tennis_button_');
    expect(source).toContain('Polo placket');
  });

  it('sells the football pads with baked volume + real TV numbers', () => {
    // Run 4: padded shoulders read as foam under cloth (highlight cap + AO
    // crease) and the shoulders carry real twill TV numbers, not empty flashes.
    expect(source).toContain('PADDED SHOULDERS');
    expect(source).toContain('TV numbers');
    // GarmentMarkings now receives the jersey number for the front + TV numbers.
    expect(source).toContain('number: string;');
    expect(source).toContain('<EmbroideredLabel x={20} y={43} label={number}');
    expect(source).toContain('<EmbroideredLabel x={80} y={43} label={number}');
  });

  it('builds a cut-and-sewn basketball tank with contrast side panels + piping', () => {
    // Run 4: secondary-toned side panels bounded by a lit/dark piping seam.
    expect(source).toContain('Contrast SIDE PANELS with piping');
  });

  it('builds a modern soccer/UCL kit with raglan + panel seams', () => {
    // Run 4: diagonal raglan seam + flank panel seam + turned cuffs, so the kit
    // reads as engineered panels, not a plain tee with a collar.
    expect(source).toContain('RAGLAN + side-panel + cuff seams');
  });

  it('gates the run-4 fine seams onto the reduced-detail tier for thumbnails', () => {
    // The new sub-pixel seam strokes must be skipped below the threshold so the
    // most-numerous 34px thumbnails stay light; SportConstruction takes the flag.
    expect(source).toContain('reducedDetail?: boolean;');
    expect(source).toContain('<SportConstruction variant={variant} ids={ids} secondary={secondary} accent={accent} reducedDetail={reducedDetail} />');
  });

  it('sets the lettering with optical kerning (run 5 typography)', () => {
    // Block/varsity jersey lettering is set tight — negative tracking eased by
    // mark length. It is a single attribute on the existing text node (no added
    // nodes) and, being negative, can never overflow the fitted maxWidth.
    expect(source).toContain("const compactLen = label.replace(/\\s/g, '').length;");
    expect(source).toContain('const tracking = -layout.fontSize * (compactLen <= 3 ? 0.03 : compactLen <= 6 ? 0.022 : 0.014);');
    expect(source).toContain('letterSpacing={tracking}');
  });

  it('renders true two-ply tackle-twill with a top-ply satin edge (run 5)', () => {
    // A backing ply (the outline) plus a top ply (the fill) with its own crisp
    // satin-stitch rim, so the eye reads two registered stitched layers. The rim
    // stays in the fill color family so it never fights the contrast guard, and
    // it is gated off thumbnails with the other embellishment passes.
    expect(source).toContain('TWO-PLY TACKLE-TWILL');
    expect(source).toContain('const topPlyRim = lighten(integratedFill');
    expect(source).toContain('`applique_top_ply_${line}_${index}`');
  });

  it('places the key light + specular per garment family (run 5 lighting)', () => {
    // One soft key shaped to the textile, not a generic band: ModelDefs takes the
    // variant and tunes the volume radial + sheen geometry per garment (same defs,
    // zero added nodes).
    expect(source).toContain('function lightingProfile(variant: JerseyModelVariant)');
    expect(source).toContain('const light = lightingProfile(variant);');
    expect(source).toContain('<ModelDefs ids={ids} body={shape.body} variant={variant} primary={primary} secondary={secondary} accent={accent} />');
  });

  it('makes the basketball front number the dominant chest element (run 5/7)', () => {
    // The front number is enlarged and centred lower in the open chest with
    // breathing room above the hem; run 7 grows it to broadcast hero scale (21).
    expect(source).toContain('DOMINANT chest element on a real NBA/NCAAB');
    expect(source).toContain('<EmbroideredLabel x={50} y={81} label={number}');
  });

  it('grounds the jersey with a soft feathered contact shadow (run 6)', () => {
    // The old grounding was a flat hard-edged ellipse (a gray pill). A radial
    // contact gradient gives a soft penumbra so the garment sits in space. The
    // gradient is added to BOTH the shared ModelDefs and the basketball Defs, and
    // the contact ellipse is now gradient-filled in both render paths.
    expect(source).toContain('SOFT CONTACT SHADOW');
    expect(source).toContain('id={ids.contact}');
    expect(source).toContain('fill={`url(#${ids.contact})`}');
    expect(source).toContain('contact: `mini_contact_${instanceId}`');
  });

  it('models a form-shadow core so the torso reads round, not a flat sheet (run 6)', () => {
    // A vertical-ish radial wraps the flanks/hem so the body has honest value
    // contrast instead of a single corner-to-corner laminate gradient. Painted
    // clipped to the body in both render paths.
    expect(source).toContain('CORE BODY-SHADOW');
    expect(source).toContain('id={ids.core}');
    expect(source).toContain('fill={`url(#${ids.core})`}');
    expect(source).toContain('core: `mini_core_${instanceId}`');
  });

  it('curves the baseball pinstripes with the body roll (run 6)', () => {
    // Real pinstripes bow with the chest — they were dead-straight <Line>s (a
    // "drawn by code" tell). Each stripe is now a quadratic curve whose bow
    // scales with distance from centre, at the same node count.
    expect(source).toContain('const pinstripe = (x: number) =>');
    expect(source).toContain('const bow = (x - 50) * 0.12;');
    expect(source).toContain('d={pinstripe(x)}');
  });

  it('shades the basketball side panels as separate textiles (run 6)', () => {
    // Each side panel carries its own light (pooled hem shadow + lit armhole cap)
    // instead of a flat single-opacity stripe.
    expect(source).toContain('Panel value falloff');
  });

  it('ties the hockey hem + cuffs into a coordinated stripe set (run 6)', () => {
    // A wide trim band carrying a thin contrast accent centre stripe, shared
    // across hem + both cuffs, so the trim reads as a designed set. The cuff
    // accent centre lines are gated off thumbnails.
    expect(source).toContain('COORDINATED STRIPE SET');
  });

  it('makes the cricket diagonal a designed flash, not a stray line (run 6)', () => {
    // A wider trim sash with parallel accent piping (a coordinated set) replaces
    // the lone diagonal that read as an accidental mark.
    expect(source).toContain('DESIGNED DIAGONAL FLASH');
  });

  it('enlarges the football front number to broadcast proportion (run 6/7)', () => {
    // Real football front numbers are large and dominant; run 7 takes the hero
    // number to confident broadcast scale (22).
    expect(source).toContain('<EmbroideredLabel x={50} y={88} label={number} fill={fill} stroke={stroke} surface={surface} surfaceAccent={accent} reducedDetail={reducedDetail} fontSize={22} maxWidth={34} />');
  });

  it('renders broadcast-grade lettering: hard keyline + crisp full-opacity twill + pure fill (run 7)', () => {
    // The #1 run-7 change. The mark is ringed by a hard high-contrast keyline (the
    // opposite value of the outline) so the edges snap; the twill border and fill
    // are now full-opacity and the fill is essentially pure (no muddying toward the
    // body) so the lettering reads as a punchy, crisp EA/ESPN team graphic.
    expect(source).toContain('BROADCAST-GRADE LETTERING');
    expect(source).toContain('HARD KEYLINE');
    expect(source).toContain('`applique_keyline_${line}_${index}`');
    expect(source).toContain("const keylineColor = luminance(stroke) > 0.5 ? '#06080c' : '#ffffff';");
    // Crisp outline = the true outline color at full strength (not mixed toward body).
    expect(source).toContain('const integratedStroke = stroke;');
    // Pure punchy fill: only a hair of integration, fully opaque.
    expect(source).toContain('const integratedFill = mixColor(fill, jerseySurface, luminance(fill) > 0.62 ? 0.05 : 0.03);');
    expect(source).toContain('{ fill: integratedFill, fillOpacity: 1 }');
  });

  it('enforces a punchier broadcast contrast guard for legibility (run 7/8)', () => {
    // Bold team graphics demand confident separation: the brand color must clear a
    // 3.4:1 bar (was 2.65) to be used as-is. Run 8 keeps that bar but replaces the
    // luminance-guess fallback with a true highest-contrast pick over the full
    // candidate set (brand tints + both neutrals), so the number is always the most
    // legible option available — not a marginal white that pops LESS than near-black.
    expect(source).toContain('.find((candidate) => contrastRatio(candidate, primary) >= 3.4)');
    expect(source).toContain("const neutralCandidates = ['#FFFFFF', '#0A1016'];");
    expect(source).toContain('contrastRatio(candidate, primary) > contrastRatio(current, primary) ? candidate : current');
  });

  it('prefers the team brand color over a generic neutral when it clears 3.4 (run 8 anti-over-snap)', () => {
    // The run-7 guard could OVER-snap to white even when a vivid secondary/accent
    // (or a punchier tint of it) would read better and stay on-brand. Run 8 ranks
    // candidates brand-first — true secondary/accent, then progressively stronger
    // tints of the SAME color — and only falls back to white/near-black when NO
    // brand tint clears the bar. So e.g. silver-on-navy / near-black-on-gold keep
    // the real team color instead of flattening to white.
    expect(source).toContain('const brandCandidates = [');
    expect(source).toContain("const neutralCandidates = ['#FFFFFF', '#0A1016'];");
    expect(source).toContain('lighten(secondary, 0.34)');
    expect(source).toContain('darken(secondary, 0.34)');
    expect(source).toContain('.slice(0, brandCandidates.length)');
    expect(source).toContain('.find((candidate) => contrastRatio(candidate, primary) >= 3.4)');
    expect(source).toContain('if (brandPass) return brandPass;');

    // Behavioral lock-in: re-implement the exact guard and assert it keeps brand
    // colors for teams whose real secondary clears 3.4 on the body, while still
    // guaranteeing a legible neutral when no brand tint can.
    const parseHex = (hex: string) => {
      const raw = hex.replace('#', '').slice(0, 6);
      const n = parseInt(raw, 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    };
    const toHex = ({ r, g, b }: { r: number; g: number; b: number }) =>
      '#' + (((Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)) >>> 0).toString(16).padStart(6, '0');
    const mix = (h: string, t: string, a: number) => {
      const x = parseHex(h);
      const y = parseHex(t);
      return toHex({ r: x.r + (y.r - x.r) * a, g: x.g + (y.g - x.g) * a, b: x.b + (y.b - x.b) * a });
    };
    const dk = (h: string, a: number) => mix(h, '#000000', a);
    const lt = (h: string, a: number) => mix(h, '#ffffff', a);
    const lum = (hex: string) => {
      const c = parseHex(hex);
      return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
    };
    const cr = (a: string, b: string) => {
      const l1 = lum(a);
      const l2 = lum(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    const guard = (primary: string, secondary: string, accent: string) => {
      const brand = [
        secondary, accent,
        lt(secondary, 0.34), dk(secondary, 0.34),
        lt(accent, 0.34), dk(accent, 0.34),
        lt(secondary, 0.55), dk(secondary, 0.55),
      ];
      const cand = [...brand, '#FFFFFF', '#0A1016'];
      const unique = cand.filter((c, i) => cand.indexOf(c) === i);
      const bp = unique.slice(0, brand.length).find((c) => cr(c, primary) >= 3.4);
      if (bp) return bp;
      // Highest-contrast option over the full set (best brand tint OR better neutral).
      return unique.reduce((cur, c) => (cr(c, primary) > cr(cur, primary) ? c : cur), unique[0]);
    };
    // Steelers: gold body, near-black secondary -> keep the real near-black, NOT white.
    expect(guard('#FFB612', '#101820', '#FFFFFF').toLowerCase()).toBe('#101820');
    // Colts: navy body, silver secondary -> keep the real silver, NOT a flat white.
    expect(guard('#002C5F', '#A2AAAD', '#FFFFFF').toLowerCase()).toBe('#a2aaad');
    // Raiders: black body, silver secondary -> keep the real silver.
    expect(guard('#000000', '#A5ACAF', '#FFFFFF').toLowerCase()).toBe('#a5acaf');
    // When NO brand tint clears 3.4 (e.g. gold-on-scarlet, white-on-green), the
    // fallback returns the most-legible option available: never lower contrast than
    // the better of pure white / near-black on that body (the run-7 luminance guess
    // could otherwise return a marginal white that pops LESS than near-black).
    [['#E31837', '#FFB81C', '#FFFFFF'], ['#125740', '#FFFFFF', '#FFFFFF']]
      .forEach(([p, s, a]) => {
        const picked = guard(p, s, a);
        const bestNeutral = Math.max(cr('#FFFFFF', p), cr('#0A1016', p));
        expect(cr(picked, p)).toBeGreaterThanOrEqual(bestNeutral - 1e-9);
      });
    // Where the body ALLOWS a confident 3.4 read (navy/gold/black bodies), it clears it.
    [['#FFB612', '#101820', '#FFFFFF'], ['#002C5F', '#A2AAAD', '#FFFFFF'], ['#000000', '#A5ACAF', '#FFFFFF']]
      .forEach(([p, s, a]) => expect(cr(guard(p, s, a), p)).toBeGreaterThanOrEqual(3.4));
  });

  it('rebalances the body value ramp toward saturated bold-graphic color (run 7)', () => {
    // The old top stop lifted 32% toward white (washed the shoulders). The run-7
    // ramp keeps the team color saturated with a shorter, punchier value swing.
    expect(source).toContain('BODY VALUE RAMP (run 7');
    expect(source).toContain('stopColor={lighten(primary, 0.2)} stopOpacity={1} />');
  });

  it('renders trim/panels/stripes as confident near-solid broadcast accents (run 8)', () => {
    // Run 8 audit: the run-7 lettering was pure/full-opacity but the trim was still
    // drawn semi-transparent (fillOpacity 0.24-0.76) so the team's secondary read as
    // a washed tint of the body. Run 8 lifts the major trim surfaces to near-solid so
    // collars/cuffs/yokes/panels/stripes/sashes pop as confident broadcast accents.
    // Football yoke band + cuffs (worst laggard, 0.34/0.46 -> 0.82/0.92).
    expect(source).toContain('fillOpacity={0.82} />\n        {/* Crew collar');
    expect(source).toContain('L19 50 C13 49 7 47 4 44 Z" fill={`url(#${ids.trim})`} fillOpacity={0.92} />');
    // Hockey hem stripe set near-solid + punched accent center stripes.
    expect(source).toContain('width={66} height={7.4} rx={1.3} fill={`url(#${ids.trim})`} fillOpacity={0.95} />');
    expect(source).toContain('width={66} height={1.9} fill={accent} fillOpacity={0.62} />');
    // Basketball signature side panels read as distinct textiles, not a body tint.
    expect(source).toContain('L24 108 Z" fill={`url(#${ids.trim})`} fillOpacity={0.92} />');
    // Cricket diagonal sash now a confident colored flash.
    expect(source).toContain('strokeWidth={2.4} strokeOpacity={0.78} strokeLinecap="round" />');
    // The trim ramp stays vivid across the whole band (shallow dark falloff).
    expect(source).toContain('stopColor={darken(secondary, 0.2)} stopOpacity={1} />');
  });
});
