"""3D Scene composition and PyVista actor management.

Non-negotiable Invariants:
- I3: Vertical exaggeration is a render-only multiplier.
- I4: Only the main thread touches VTK actors.
- I5: Mesh objects are created ONCE; frames mutate mesh.points and mesh.point_data in place.
- I6: Sign convention: z = -S * exaggeration.
"""
from typing import Any
import matplotlib.colors as mcolors
import numpy as np
import pyvista as pv


# 1. Natural Game Terrain (Highland meadow -> slope -> weathered loam -> deep quarry bedrock)
GAME_TERRAIN_COLORS = [
    "#224b2d",  # Lush highland grass (0 mm)
    "#35623f",  # 150 mm: slight meadow sag
    "#4d7c54",  # 350 mm: vegetated slope
    "#7a9163",  # 650 mm: savanna slope
    "#9c9b73",  # 950 mm: weathered subsoil
    "#a3825d",  # 1250 mm: sandstone & loam
    "#855b3d",  # 1550 mm: exposed bedrock
    "#5c341f",  # 1800 mm: high-tension fault rock
    "#32140a",  # 1950 mm: trough floor
]
GAME_TERRAIN_CMAP = mcolors.LinearSegmentedColormap.from_list("game_terrain", GAME_TERRAIN_COLORS, N=256)

# 2. Stepped Topographic GIS (Discrete 200mm elevation contour bands)
TOPOGRAPHIC_COLORS = [
    "#1b4332",  # 0-200 mm
    "#2d6a4f",  # 200-400 mm
    "#40916c",  # 400-600 mm
    "#52b788",  # 600-800 mm
    "#74c69d",  # 800-1000 mm
    "#b7b7a4",  # 1000-1200 mm
    "#ddbea9",  # 1200-1400 mm
    "#cb997e",  # 1400-1600 mm
    "#a57f60",  # 1600-1800 mm
    "#6b4d3c",  # 1800-2000 mm
]
TOPOGRAPHIC_CMAP = mcolors.LinearSegmentedColormap.from_list("topographic_gis", TOPOGRAPHIC_COLORS, N=10)

# 3. Dark Slate / Cyberpunk Tactical GIS
DARK_SLATE_COLORS = [
    "#181e26",  # 0 mm: undisturbed basalt
    "#252f3d",  # 350 mm
    "#374659",  # 750 mm
    "#50647e",  # 1200 mm
    "#728ba6",  # 1650 mm
    "#9ec3d6",  # 1950 mm: glowing bedrock core
]
DARK_SLATE_CMAP = mcolors.LinearSegmentedColormap.from_list("dark_slate", DARK_SLATE_COLORS, N=256)


class SubsidenceScene:
    """Manages all PyVista actors, meshes, colormaps, and real-time mesh mutations."""

    THEMES = ["game_terrain", "topographic", "dark_slate", "turbo"]

    def __init__(
        self,
        plotter: pv.Plotter,
        nx: int = 64,
        ny: int = 64,
        x_bounds: tuple[float, float] = (25.0, 775.0),
        y_bounds: tuple[float, float] = (25.0, 375.0),
        panel_config: dict[str, Any] | None = None,
        nodes_config: list[dict[str, Any]] | None = None,
        anchors_config: list[dict[str, Any]] | None = None,
        gateway_config: dict[str, Any] | None = None,
    ):
        self.plotter = plotter
        self.nx = nx
        self.ny = ny
        self.x_bounds = x_bounds
        self.y_bounds = y_bounds
        self.panel_config = panel_config or {
            "x1": 100.0, "y1": 100.0, "x2": 700.0, "y2": 300.0,
            "depth_m": 150.0, "thickness_m": 3.0, "tan_beta": 2.0
        }
        self.nodes_config = nodes_config or []
        self.anchors_config = anchors_config or []
        self.gateway_config = gateway_config or {"id": 200, "xy": [860.0, 200.0]}

        self.exaggeration: float = 100.0
        self.show_truth_ghost: bool = True
        self.show_error_sheet: bool = False
        self.show_draw_cones: bool = False
        self.show_ext_lines: bool = True

        self.current_theme_idx: int = 0
        self.current_cmap = GAME_TERRAIN_CMAP

        # Precompute coordinate grids
        x_lin = np.linspace(self.x_bounds[0], self.x_bounds[1], self.nx, dtype=np.float32)
        y_lin = np.linspace(self.y_bounds[0], self.y_bounds[1], self.ny, dtype=np.float32)
        self.X_grid, self.Y_grid = np.meshgrid(x_lin, y_lin)
        self.x_flat = self.X_grid.ravel()
        self.y_flat = self.Y_grid.ravel()
        self.z_flat = np.zeros_like(self.x_flat)

        # Build initial meshes
        self._init_reconstruction_mesh()
        self._init_truth_ghost_mesh()
        self._init_panel_box()
        self._init_draw_angle_lines()
        self._init_anchors_and_gateway()
        self._init_node_actors()
        self._init_extensometer_actors()

    def _init_reconstruction_mesh(self) -> None:
        """Create the primary 64x64 reconstruction StructuredGrid (created ONCE, mutated in-place)."""
        grid = pv.StructuredGrid()
        points = np.column_stack((self.x_flat, self.y_flat, self.z_flat))
        grid.points = points
        grid.dimensions = [self.nx, self.ny, 1]
        grid.point_data["subsidence_mm"] = np.zeros(self.nx * self.ny, dtype=np.float32)
        grid.point_data["error_mm"] = np.zeros(self.nx * self.ny, dtype=np.float32)

        self.recon_mesh = grid
        self.recon_actor = self.plotter.add_mesh(
            self.recon_mesh,
            scalars="subsidence_mm",
            cmap=self.current_cmap,
            clim=[0.0, 1950.0],
            scalar_bar_args={
                "title": "Subsidence (mm)",
                "vertical": True,
                "position_x": 0.88,
                "position_y": 0.25,
                "title_font_size": 12,
                "label_font_size": 10,
                "color": "white",
            },
            show_edges=True,
            edge_color="#102517",
            edge_opacity=0.35,
            smooth_shading=True,
            ambient=0.45,
            diffuse=0.80,
            specular=0.20,
            name="recon_surface",
        )

    def _init_truth_ghost_mesh(self) -> None:
        """Create the 64x64 wireframe truth ghost grid."""
        grid = pv.StructuredGrid()
        points = np.column_stack((self.x_flat, self.y_flat, self.z_flat))
        grid.points = points
        grid.dimensions = [self.nx, self.ny, 1]

        self.truth_mesh = grid
        self.truth_actor = self.plotter.add_mesh(
            self.truth_mesh,
            style="wireframe",
            color="lightgrey",
            opacity=0.25,
            line_width=1.0,
            show_scalar_bar=False,
            name="truth_ghost",
        )
        self.truth_actor.SetVisibility(self.show_truth_ghost)

    def _init_panel_box(self) -> None:
        """Create the underground mined panel box (volumetric coal seam)."""
        p = self.panel_config
        x_min, x_max = p["x1"], p["x2"]
        y_min, y_max = p["y1"], p["y2"]
        depth = p["depth_m"]
        thick = p.get("thickness_m", 3.0)

        # Panel volume at z = -depth to z = -depth + thickness
        box = pv.Box(bounds=(x_min, x_max, y_min, y_max, -depth, -depth + thick))
        self.panel_box_mesh = box
        self.panel_box_actor = self.plotter.add_mesh(
            self.panel_box_mesh,
            color="#d97706",
            opacity=0.30,
            show_edges=True,
            edge_color="#f59e0b",
            line_width=1.5,
            show_scalar_bar=False,
            name="panel_box",
        )

    def _init_draw_angle_lines(self) -> None:
        """Create lines from the 4 panel corners up and out at draw angle beta."""
        p = self.panel_config
        depth = p["depth_m"]
        tan_b = p.get("tan_beta", 2.0)
        offset = depth / tan_b  # 75 m offset

        corners = [
            (p["x1"], p["y1"], -depth, p["x1"] - offset, p["y1"] - offset, 0.0),
            (p["x2"], p["y1"], -depth, p["x2"] + offset, p["y1"] - offset, 0.0),
            (p["x2"], p["y2"], -depth, p["x2"] + offset, p["y2"] + offset, 0.0),
            (p["x1"], p["y2"], -depth, p["x1"] - offset, p["y2"] + offset, 0.0),
        ]

        lines = []
        for c in corners:
            line = pv.Line((c[0], c[1], c[2]), (c[3], c[4], c[5]))
            lines.append(line)

        draw_lines = lines[0]
        for l in lines[1:]:
            draw_lines = draw_lines.merge(l)

        self.draw_lines_mesh = draw_lines
        self.draw_lines_actor = self.plotter.add_mesh(
            self.draw_lines_mesh,
            color="grey",
            line_width=1.5,
            show_scalar_bar=False,
            name="draw_cones",
        )
        self.draw_lines_actor.SetVisibility(self.show_draw_cones)

    def _init_anchors_and_gateway(self) -> None:
        """Create anchor spheres (blue) and gateway cone (white)."""
        # Anchors (z=0)
        self.anchor_actors = []
        for a in self.anchors_config:
            xy = a["xy"]
            sphere = pv.Sphere(radius=8.0, center=(xy[0], xy[1], 0.0))
            actor = self.plotter.add_mesh(
                sphere,
                color="dodgerblue",
                smooth_shading=True,
                show_scalar_bar=False,
                name=f"anchor_{a['id']}",
            )
            self.anchor_actors.append(actor)

        # Gateway (cone at 860, 200)
        gw_xy = self.gateway_config["xy"]
        cone = pv.Cone(center=(gw_xy[0], gw_xy[1], 10.0), direction=(0, 0, 1), height=20.0, radius=10.0)
        self.gateway_actor = self.plotter.add_mesh(
            cone,
            color="white",
            smooth_shading=True,
            show_scalar_bar=False,
            name="gateway_cone",
        )

    def _init_node_actors(self) -> None:
        """Create 30 node sphere meshes (radius 6m) positioned on the surface."""
        self.node_actors = {}
        self.node_spheres = {}

        # Default colors
        for node in self.nodes_config:
            nid = node["id"]
            xy = node["xy"]
            sphere = pv.Sphere(radius=6.0, center=(xy[0], xy[1], 0.0))
            self.node_spheres[nid] = sphere
            actor = self.plotter.add_mesh(
                sphere,
                color="limegreen",
                smooth_shading=True,
                show_scalar_bar=False,
                name=f"node_{nid}",
            )
            self.node_actors[nid] = actor

    def _init_extensometer_actors(self) -> None:
        """Create white lines for extensometers connecting peg A to peg C."""
        self.ext_lines = {}
        self.ext_actors = {}

        for node in self.nodes_config:
            nid = node["id"]
            xyA = node["xy"]
            xyC = node.get("ext_to", [xyA[0], xyA[1] + 10.0])
            line = pv.Line((xyA[0], xyA[1], 0.0), (xyC[0], xyC[1], 0.0))
            self.ext_lines[nid] = line
            actor = self.plotter.add_mesh(
                line,
                color="white",
                line_width=2.5,
                show_scalar_bar=False,
                name=f"ext_{nid}",
            )
            actor.SetVisibility(self.show_ext_lines)
            self.ext_actors[nid] = actor

    def update_surface(
        self,
        recon_z: np.ndarray,
        truth_z: np.ndarray | None = None,
        node_states: dict[int, dict[str, Any]] | None = None,
    ) -> None:
        """Mutate the 3D surface mesh in place (Invariant I5).

        Args:
            recon_z: 1D or 2D array of subsidence in metres (positive downward).
            truth_z: Optional truth subsidence array for truth ghost and error sheet.
            node_states: Optional dictionary mapping node_id to status {'alive': bool, 'alarming': bool, 'strain': float}
        """
        exag = self.exaggeration
        s_recon = np.asarray(recon_z, dtype=np.float32).ravel()

        # Invariant I6: z = -S * exaggeration
        self.recon_mesh.points[:, 2] = -s_recon * exag
        s_mm = s_recon * 1000.0
        self.recon_mesh.point_data["subsidence_mm"] = s_mm

        # Update truth ghost and error sheet if truth provided
        if truth_z is not None:
            s_truth = np.asarray(truth_z, dtype=np.float32).ravel()
            self.truth_mesh.points[:, 2] = -s_truth * exag
            err_mm = np.abs(s_recon - s_truth) * 1000.0
            self.recon_mesh.point_data["error_mm"] = err_mm

        # Switch active scalar field if error sheet toggled
        if self.show_error_sheet:
            self.recon_mesh.set_active_scalars("error_mm")
            self.recon_actor.mapper.SetScalarRange(0.0, 100.0)
            self.recon_actor.mapper.lookup_table.cmap = "inferno"
        else:
            self.recon_mesh.set_active_scalars("subsidence_mm")
            self.recon_actor.mapper.SetScalarRange(0.0, 1950.0)
            self.recon_actor.mapper.lookup_table.cmap = self.current_cmap

    def cycle_terrain_style(self) -> str:
        """Cycle through game terrain, topographic GIS, dark slate, and thermal heatmap."""
        self.current_theme_idx = (self.current_theme_idx + 1) % len(self.THEMES)
        theme = self.THEMES[self.current_theme_idx]
        if theme == "game_terrain":
            self.current_cmap = GAME_TERRAIN_CMAP
            self.recon_actor.prop.edge_color = "#102517"
            self.recon_actor.prop.edge_opacity = 0.35
            self.recon_actor.prop.ambient = 0.45
            self.recon_actor.prop.diffuse = 0.80
        elif theme == "topographic":
            self.current_cmap = TOPOGRAPHIC_CMAP
            self.recon_actor.prop.edge_color = "#1e293b"
            self.recon_actor.prop.edge_opacity = 0.50
            self.recon_actor.prop.ambient = 0.50
            self.recon_actor.prop.diffuse = 0.75
        elif theme == "dark_slate":
            self.current_cmap = DARK_SLATE_CMAP
            self.recon_actor.prop.edge_color = "#0f172a"
            self.recon_actor.prop.edge_opacity = 0.40
            self.recon_actor.prop.ambient = 0.40
            self.recon_actor.prop.diffuse = 0.85
        else:
            self.current_cmap = "turbo"
            self.recon_actor.prop.edge_opacity = 0.0

        if not self.show_error_sheet:
            self.recon_actor.mapper.lookup_table.cmap = self.current_cmap
        return theme

        # Update node sphere positions and colors
        if node_states:
            for node in self.nodes_config:
                nid = node["id"]
                xy = node["xy"]
                st = node_states.get(nid, {"alive": True, "alarming": False})

                # Interpolate height at node xy
                # Grid coordinates
                gx = (xy[0] - self.x_bounds[0]) / (self.x_bounds[1] - self.x_bounds[0]) * (self.nx - 1)
                gy = (xy[1] - self.y_bounds[0]) / (self.y_bounds[1] - self.y_bounds[0]) * (self.ny - 1)
                ix = int(np.clip(round(gx), 0, self.nx - 1))
                iy = int(np.clip(round(gy), 0, self.ny - 1))
                idx = iy * self.nx + ix
                z_node = self.recon_mesh.points[idx, 2]

                # Update sphere center
                sphere = self.node_spheres.get(nid)
                actor = self.node_actors.get(nid)
                if sphere and actor:
                    # Update sphere mesh points translated to (xy[0], xy[1], z_node)
                    # A clean way is translating the sphere polydata or re-centering
                    sphere.points[:, 0] += (xy[0] - sphere.center[0])
                    sphere.points[:, 1] += (xy[1] - sphere.center[1])
                    sphere.points[:, 2] += (z_node - sphere.center[2])

                    # Color encoding: Green alive, Grey dead, Amber alarming
                    if not st.get("alive", True):
                        actor.prop.color = "dimgrey"
                    elif st.get("alarming", False):
                        actor.prop.color = "gold"
                    else:
                        actor.prop.color = "limegreen"

                # Update extensometer line endpoints on the deformed surface
                ext_line = self.ext_lines.get(nid)
                if ext_line:
                    xyC = node.get("ext_to", [xy[0], xy[1] + 10.0])
                    gxC = (xyC[0] - self.x_bounds[0]) / (self.x_bounds[1] - self.x_bounds[0]) * (self.nx - 1)
                    gyC = (xyC[1] - self.y_bounds[0]) / (self.y_bounds[1] - self.y_bounds[0]) * (self.ny - 1)
                    ixC = int(np.clip(round(gxC), 0, self.nx - 1))
                    iyC = int(np.clip(round(gyC), 0, self.ny - 1))
                    idxC = iyC * self.nx + ixC
                    zC = self.recon_mesh.points[idxC, 2]

                    ext_line.points[0] = [xy[0], xy[1], z_node + 0.5]
                    ext_line.points[1] = [xyC[0], xyC[1], zC + 0.5]

    def set_exaggeration(self, exag: float) -> None:
        """Set vertical exaggeration multiplier (Invariant I3)."""
        self.exaggeration = float(exag)

    def toggle_truth_ghost(self) -> bool:
        self.show_truth_ghost = not self.show_truth_ghost
        self.truth_actor.SetVisibility(self.show_truth_ghost)
        return self.show_truth_ghost

    def toggle_error_sheet(self) -> bool:
        self.show_error_sheet = not self.show_error_sheet
        return self.show_error_sheet

    def toggle_draw_cones(self) -> bool:
        self.show_draw_cones = not self.show_draw_cones
        self.draw_lines_actor.SetVisibility(self.show_draw_cones)
        return self.show_draw_cones

    def toggle_ext_lines(self) -> bool:
        self.show_ext_lines = not self.show_ext_lines
        for actor in self.ext_actors.values():
            actor.SetVisibility(self.show_ext_lines)
        return self.show_ext_lines
