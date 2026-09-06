"""
3D Interactive Mine Collapse & Vibration Visualizer using PyVista.

Features:
1. 3D Surface terrain mesh with Knothe subsidence depression.
2. 3D Underground strata block (375m depth) down to coal seam.
3. Dropping sensor spheres with dynamic displacement and strain alert colors.
4. Dynamic seismic shockwave ripples and ground vibration upon pillar failure.
5. Interactive time scrubber slider and collapse trigger button.
"""

import math
import sys
from pathlib import Path

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import numpy as np
import pyvista as pv
import scipy.special

from sandbox.constants import (
    A_SUBS,
    C_KNOTHE,
    H_DEPTH_M,
    M_SEAM_M,
    R_INFL,
    WINDOW_SIZE_M,
)

# Adriyala Mine advance rate
FACE_ADVANCE_M_PER_DAY = 3.5  # m/day


def compute_knothe_subsidence_grid(X, Y, t_days, face_x_start=-100.0, y1=-125.0, y2=125.0):
    """Compute 2D Knothe subsidence grid at time t_days."""
    W_max = A_SUBS * M_SEAM_M      # 2.25 m
    r = R_INFL                     # 197.37 m
    v = FACE_ADVANCE_M_PER_DAY     # 3.5 m/day
    c = C_KNOTHE                   # 0.04 /day
    
    face_x = face_x_start + v * t_days
    time_factor = 1.0 - np.exp(-c * t_days) if t_days > 0 else 0.0
    sq_pi_r = np.sqrt(np.pi) / r
    
    Fy_grid = 0.5 * (scipy.special.erf(sq_pi_r * (Y - y1)) - scipy.special.erf(sq_pi_r * (Y - y2)))
    Fx_grid = 0.5 * (scipy.special.erf(sq_pi_r * (X - face_x_start)) - scipy.special.erf(sq_pi_r * (X - face_x)))
    
    S = W_max * Fx_grid * Fy_grid * time_factor
    return np.maximum(0.0, S)


class MineVisualizer3D:
    def __init__(self, nx=80, ny=80, exaggeration=50.0):
        self.nx = nx
        self.ny = ny
        self.exaggeration = exaggeration  # Visual vertical exaggeration for human eye
        self.t_days = 10.0                # Current sim time (days)
        self.collapse_active = False
        self.collapse_t0 = 0.0
        self.collapse_center = np.array([50.0, 0.0])
        self.collapse_magnitude = 0.75   # 0.75m sudden void collapse
        
        # Grid setup (600m x 600m window)
        half_w = WINDOW_SIZE_M / 2.0
        x = np.linspace(-half_w, half_w, nx)
        y = np.linspace(-half_w, half_w, ny)
        self.X, self.Y = np.meshgrid(x, y)
        self.Z_baseline = np.zeros_like(self.X)
        
        # 3D Structured Surface Mesh
        self.surface_mesh = pv.StructuredGrid(self.X, self.Y, self.Z_baseline)
        
        # Sensor Layout
        self.sensor_locs = np.array([
            [-150.0, 0.0],
            [-50.0,  0.0],
            [  0.0,  0.0],
            [ 50.0,  0.0],
            [100.0,  0.0],
            [200.0,  0.0],
            [ 50.0, 50.0],
            [ 50.0,-50.0],
        ])
        self.num_sensors = len(self.sensor_locs)
        
        # Build Underground Strata & Coal Seam Box
        self.strata_mesh = pv.Box(bounds=(-half_w, half_w, -half_w, half_w, -H_DEPTH_M, 0.0))
        self.coal_seam = pv.Box(bounds=(-half_w, half_w, -half_w, half_w, -H_DEPTH_M, -H_DEPTH_M + M_SEAM_M))
        
        # Setup Plotter
        self.plotter = pv.Plotter(window_size=[1200, 850], title="Adriyala Mine 3D Collapse & Vibration Simulator")
        self.plotter.set_background("#0f172a", top="#1e293b")  # Sleek dark navy gradient
        
    def get_ground_elevation_and_vibration(self, t_days):
        """Calculate vertical deformation Z and dynamic shockwave vibrations."""
        # 1. Static Knothe Subsidence
        S_static = compute_knothe_subsidence_grid(self.X, self.Y, t_days)
        
        # 2. Dynamic Pillar Collapse & Shockwave
        S_dynamic = np.zeros_like(S_static)
        vibration_intensity = np.zeros_like(S_static)
        
        if self.collapse_active:
            dt_collapse_sec = (t_days - self.collapse_t0) * 86400.0  # seconds since collapse
            if dt_collapse_sec >= 0:
                dist = np.hypot(self.X - self.collapse_center[0], self.Y - self.collapse_center[1])
                r_void = 80.0
                gaussian_profile = self.collapse_magnitude * np.exp(-(dist / r_void) ** 2)
                
                # Step drop with settling
                S_dynamic = gaussian_profile * (1.0 - np.exp(-dt_collapse_sec / 300.0))
                
                # Elastic shockwave ripple propagating outward at 1800 m/s
                v_wave = 1800.0
                wave_front = v_wave * (dt_collapse_sec % 10.0)  # cycling ripple for animation
                wavelength = 60.0
                wave_phase = 2.0 * np.pi * (dist - wave_front) / wavelength
                wave_decay = np.exp(-dist / 200.0) * np.exp(-dt_collapse_sec / 15.0)
                
                vibration_intensity = 0.15 * np.cos(wave_phase) * wave_decay
        
        total_subsidence = S_static + S_dynamic + vibration_intensity
        # Z is negative downward (into the earth)
        Z_current = -total_subsidence * self.exaggeration
        
        return Z_current, total_subsidence
    
    def update_scene(self, t_days):
        """Update 3D surface mesh vertices and sensor positions."""
        self.t_days = t_days
        Z_current, total_sub = self.get_ground_elevation_and_vibration(t_days)
        
        # Update surface points
        points = np.column_stack((self.X.ravel(), self.Y.ravel(), Z_current.ravel()))
        self.surface_mesh.points = points
        self.surface_mesh["Subsidence_m"] = total_sub.ravel()
        
        # Update sensor spheres
        for idx, (sx, sy) in enumerate(self.sensor_locs):
            dist = np.hypot(self.X - sx, self.Y - sy)
            min_idx = np.argmin(dist)
            sz = Z_current.ravel()[min_idx]
            sub_val = total_sub.ravel()[min_idx]
            
            # Position sensor sphere slightly above ground
            sphere = pv.Sphere(radius=7.0, center=(sx, sy, sz + 4.0))
            self.sensor_actors[idx].mapper.SetInputData(sphere)
            
            # Color by status (Green -> Orange -> Red alert)
            if sub_val > 0.5:
                self.sensor_actors[idx].prop.color = "crimson"
            elif sub_val > 0.1:
                self.sensor_actors[idx].prop.color = "gold"
            else:
                self.sensor_actors[idx].prop.color = "springgreen"

    def trigger_collapse(self, state):
        """Trigger sudden pillar failure intervention."""
        self.collapse_active = True
        self.collapse_t0 = self.t_days
        print(f"\n💥 [INTERVENTION] Sudden Pillar Failure Triggered at t={self.t_days:.1f} days! Center=(50, 0)m, ΔS=0.75m")

    def run(self):
        """Build the full PyVista 3D interactive viewport."""
        print("=" * 70)
        print("  ADRIYALA LONGWALL PROJECT — 3D COLLAPSE & VIBRATION VISUALIZER")
        print("=" * 70)
        print("Controls:")
        print(" • Drag Left-Click: Rotate 3D Camera")
        print(" • Scroll Wheel   : Zoom In/Out")
        print(" • Bottom Slider  : Scrub Time (Days of Mining Advance)")
        print(" • Checkbox       : Trigger Sudden Pillar Collapse (Watch ground drop & vibrate!)")
        print("=" * 70)
        
        # Initial points
        Z_init, sub_init = self.get_ground_elevation_and_vibration(self.t_days)
        self.surface_mesh.points = np.column_stack((self.X.ravel(), self.Y.ravel(), Z_init.ravel()))
        self.surface_mesh["Subsidence_m"] = sub_init.ravel()
        
        # Add Underground Strata (Wireframe / Semi-Transparent)
        self.plotter.add_mesh(
            self.strata_mesh,
            color="#334155",
            opacity=0.15,
            style="wireframe",
            label="Underburden Strata (375m Depth)",
        )
        
        # Add Coal Seam at depth -375m
        self.plotter.add_mesh(
            self.coal_seam,
            color="#0f172a",
            opacity=0.8,
            label="Coal Seam (3.0m thickness at -375m)",
        )
        
        # Add Dynamic Deforming Surface Mesh with colormap
        self.surface_actor = self.plotter.add_mesh(
            self.surface_mesh,
            scalars="Subsidence_m",
            cmap="turbo",
            clim=[0.0, 1.8],
            show_edges=True,
            edge_color="#475569",
            lighting=True,
            smooth_shading=True,
            scalar_bar_args={"title": "Surface Drop / Subsidence (m)", "color": "white", "vertical": True},
        )
        
        # Add Sensor Spheres
        self.sensor_actors = []
        for sx, sy in self.sensor_locs:
            sphere = pv.Sphere(radius=7.0, center=(sx, sy, 4.0))
            actor = self.plotter.add_mesh(sphere, color="springgreen", lighting=True)
            self.sensor_actors.append(actor)
        
        # Add UI Controls
        self.plotter.add_slider_widget(
            self.update_scene,
            [0.0, 45.0],
            value=self.t_days,
            title="Simulation Time (Days of Mining Advance)",
            pointa=(0.15, 0.08),
            pointb=(0.85, 0.08),
            color="cyan",
        )
        
        self.plotter.add_checkbox_button_widget(
            self.trigger_collapse,
            value=False,
            position=(20, 20),
            size=30,
            color_on="red",
            color_off="grey",
        )
        self.plotter.add_text("Trigger Pillar Collapse", position=(60, 25), font_size=11, color="white")
        
        # Camera & Lighting
        self.plotter.camera_position = [
            (500.0, -700.0, 450.0),  # Eye
            (0.0, 0.0, -100.0),       # Target
            (0.0, 0.0, 1.0),          # Up
        ]
        self.plotter.add_axes()
        self.plotter.show()


if __name__ == "__main__":
    vis = MineVisualizer3D(nx=80, ny=80, exaggeration=60.0)
    vis.run()
