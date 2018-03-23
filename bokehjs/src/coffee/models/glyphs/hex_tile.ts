import {Glyph, GlyphView, GlyphData} from "./glyph"

import {PointGeometry, SpanGeometry} from "core/geometry"
import * as hittest from "core/hittest"
import * as p from "core/properties"
import {LineMixinVector, FillMixinVector} from "core/property_mixins"
import {Arrayable} from "core/types"
import {IBBox} from "core/util/bbox"
import {Context2d} from "core/util/canvas"
import {SpatialIndex, RBush} from "core/util/spatial"
import {NumberSpec} from "core/vectorization"
import {Line, Fill} from "core/visuals"

import {generic_area_legend} from "./utils"
import {Selection} from "../selections/selection"


export interface HexTileData extends GlyphData {
  _x: Arrayable<number>
  _y: Arrayable<number>

  sx: Arrayable<number>
  sy: Arrayable<number>

  svx: number[]
  svy: number[]

  scale: Arrayable<number>

  minX: number
  maxX: number
  minY: number
  maxY: number

  ssize: number
}

export interface HexTileView extends HexTileData {}

export class HexTileView extends GlyphView {
  model: HexTile
  visuals: HexTile.Visuals

  scenterx(i: number): number { return this.sx[i] }

  scentery(i: number): number { return this.sy[i] }

  protected _set_data(): void {
    const self = this as any

    const n = self._q.length

    const size = this.model.size

    self._x = new Float64Array(n)
    self._y = new Float64Array(n)

    if (this.model.orientation == "pointytop") {
      for (let i = 0; i < n; i++) {
        self._x[i] = size * Math.sqrt(3) * (self._q[i] + self._r[i]/2)
        self._y[i] = size * 3/2 * self._r[i]
      }
    }
    else {
      for (let i = 0; i < n; i++) {
        self._x[i] = size * 3/2 * self._q[i]
        self._y[i] = size * Math.sqrt(3) * (self._r[i] + self._q[i]/2)
      }
    }

    self.scale = self._scale
  }


  protected _index_data(): SpatialIndex {
    let ysize = this.model.size
    let xsize = Math.sqrt(3)*ysize/2
    if (this.model.orientation == "flattop") {
      [xsize, ysize] = [ysize, xsize]
    }

    const points = []
    for (let i = 0; i < this._x.length; i++) {
      const x = this._x[i]
      const y = this._y[i]
      if (isNaN(x+y) || !isFinite(x+y))
        continue
      points.push({minX: x-xsize, minY: y-ysize, maxX: x+xsize, maxY: y+ysize, i})
    }
    return new RBush(points)
  }

  // overriding map_data instead of _map_data because the default automatic mappings
  // for other glyphs (with cartesian coordinates) is not useful
  map_data(): void {
    const self = this as any

    [self.sx, self.sy] = this.map_to_screen(self._x, self._y);

    [self.svx, self.svy] = this._get_unscaled_vertices()

  }

  protected _get_unscaled_vertices(): [number[], number[]] {
    const size = this.model.size

    let rscale = this.renderer.yscale
    let hscale = this.renderer.xscale
    if (this.model.orientation == "flattop") {
      [rscale, hscale] = [hscale, rscale]
    }

    const r = Math.abs(rscale.compute(0) - rscale.compute(size)) // assumes linear scale
    const r2 = r/2.0
    const h = Math.sqrt(3)*Math.abs(hscale.compute(0) - hscale.compute(size))/2 // assumes linear scale

    let svx = [0, -h,  -h,   0,  h,  h ]
    let svy = [r,  r2, -r2, -r, -r2, r2]
    if (this.model.orientation == "flattop") {
      [svx, svy] = [svy, svx]
    }

    return [svx, svy]
  }

  protected _render(ctx: Context2d, indices: number[], {sx, sy, scale}: HexTileData): void {

    const [svx, svy] = this._get_unscaled_vertices()

    for (const i of indices) {
      if (isNaN(sx[i] + sy[i] + scale[i]))
        continue;

      ctx.translate(sx[i], sy[i])
      ctx.beginPath();
      for (let j = 0; j < 6; j++) {
        ctx.lineTo(svx[j]*scale[i], svy[j]*scale[i])
      }
      ctx.closePath()
      ctx.translate(-sx[i], -sy[i])

      if (this.visuals.fill.doit) {
        this.visuals.fill.set_vectorize(ctx, i);
        ctx.fill();
      }

      if (this.visuals.line.doit) {
        this.visuals.line.set_vectorize(ctx, i);
        ctx.stroke();
      }

    }
  }

  protected _hit_point(geometry: PointGeometry): Selection {
    const {sx, sy} = geometry
    const x = this.renderer.xscale.invert(sx)
    const y = this.renderer.yscale.invert(sy)

    const candidates = this.index.indices({minX: x, minY: y, maxX: x, maxY: y})

    const hits = Array()
    for (const i of candidates) {

      if (hittest.point_in_poly(sx-this.sx[i], sy-this.sy[i], this.svx, this.svy)) {
        hits.push(i)
      }
    }

    const result = hittest.create_empty_hit_test_result()
    result.indices = hits

    return result
  }

  protected _hit_span(geometry: SpanGeometry): Selection {
    const {sx, sy} = geometry

    let hits: number[]
    if (geometry.direction == 'v') {
      const y = this.renderer.yscale.invert(sy)
      const hr = this.renderer.plot_view.frame.bbox.h_range
      const [minX, maxX] = this.renderer.xscale.r_invert(hr.start, hr.end)
      hits = this.index.indices({minX, minY: y, maxX, maxY: y})
    } else {
      const x = this.renderer.xscale.invert(sx)
      const vr = this.renderer.plot_view.frame.bbox.v_range
      const [minY, maxY] = this.renderer.yscale.r_invert(vr.start, vr.end)
      hits = this.index.indices({minX: x, minY, maxX: x, maxY})
    }

    const result = hittest.create_empty_hit_test_result()
    result.indices = hits
    return result
  }

  draw_legend_for_index(ctx: Context2d, bbox: IBBox, index: number): void {
    generic_area_legend(this.visuals, ctx, bbox, index)
  }

}

export namespace HexTile {
  export interface Mixins extends LineMixinVector, FillMixinVector {}

  export interface Attrs extends Glyph.Attrs {
    size: number
    scale: NumberSpec
    orientation: "pointytop" | "flattop"
  }

  export interface Props extends Glyph.Props {
    size: p.Number
    scale: p.NumberSpec
    orientation: p.Property<"pointytop" | "flattop">
  }

  export interface Visuals extends Glyph.Visuals {
    line: Line
    fill: Fill
  }
}

export interface HexTile extends HexTile.Attrs { }

export class HexTile extends Glyph {

  properties: HexTile.Props

  constructor(attrs?: Partial<HexTile.Attrs>) {
    super(attrs)
  }

  static initClass(): void {
    this.prototype.type = 'HexTile'
    this.prototype.default_view = HexTileView

    this.coords([['r', 'q']])
    this.mixins(['line', 'fill'])
    this.define({
      size:        [ p.Number,     1.0         ],
      scale:       [ p.NumberSpec, 1.0         ],
      orientation: [ p.String,     "pointytop" ],
    })
    this.override({ line_color: null })
  }
}
HexTile.initClass()
