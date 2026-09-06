#!/usr/bin/env python3
"""
Generate clean, modern colored Draw.io (.drawio) XML optimized for white/light backgrounds.
- 5 to 6 words per box
- Soft tinted fills + distinct saturated borders + high-contrast dark readable typography
- Deep slate bidirectional arrows with clear legible labels
- Page 1: 5-Box Core HLD
- Page 2: 6-Box Detailed HLD
"""

import xml.etree.ElementTree as ET

def build_drawio_xml():
    xml_content = '''<mxfile host="app.diagrams.net" modified="2026-09-06T23:05:00.000Z" agent="Antigravity" version="24.0.0" type="device">
  <diagram id="core-5-box-hld" name="1. 5-Box Core HLD">
    <mxGraphModel dx="1200" dy="700" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1100" pageHeight="600" background="#FFFFFF" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />

        <!-- BOX 1: TOP - FIELD SENSORS & MESH -->
        <mxCell id="box_nodes" value="&lt;b style=&quot;font-size: 13px; color: #0369A1;&quot;&gt;Field Nodes &amp;amp; Anchors&lt;/b&gt;&lt;br/&gt;&lt;span style=&quot;font-size: 11px; color: #0C4A6E;&quot;&gt;(LoRa Mesh Network)&lt;/span&gt;" style="rounded=1;arcSize=12;whiteSpace=wrap;html=1;fillColor=#E0F2FE;strokeColor=#0284C7;strokeWidth=2;fontColor=#0C4A6E;align=center;verticalAlign=middle;" vertex="1" parent="1">
          <mxGeometry x="400" y="60" width="300" height="70" as="geometry" />
        </mxCell>

        <!-- BOX 2: CENTER - GATEWAY & INGESTION -->
        <mxCell id="box_gateway" value="&lt;b style=&quot;font-size: 13px; color: #047857;&quot;&gt;Master Gateway&lt;/b&gt;&lt;br/&gt;&lt;span style=&quot;font-size: 11px; color: #064E3B;&quot;&gt;&amp;amp; Ingestion Hub&lt;/span&gt;" style="rounded=1;arcSize=12;whiteSpace=wrap;html=1;fillColor=#D1FAE5;strokeColor=#059669;strokeWidth=2;fontColor=#064E3B;align=center;verticalAlign=middle;" vertex="1" parent="1">
          <mxGeometry x="430" y="250" width="240" height="70" as="geometry" />
        </mxCell>

        <!-- BOX 3: LEFT - AI PREDICTIVE MODEL -->
        <mxCell id="box_aimodel" value="&lt;b style=&quot;font-size: 13px; color: #6D28D9;&quot;&gt;AI Predictive Model&lt;/b&gt;&lt;br/&gt;&lt;span style=&quot;font-size: 11px; color: #4C1D95;&quot;&gt;&amp;amp; Hazard Detection&lt;/span&gt;" style="rounded=1;arcSize=12;whiteSpace=wrap;html=1;fillColor=#EDE9FE;strokeColor=#7C3AED;strokeWidth=2;fontColor=#4C1D95;align=center;verticalAlign=middle;" vertex="1" parent="1">
          <mxGeometry x="80" y="250" width="240" height="70" as="geometry" />
        </mxCell>

        <!-- BOX 4: BOTTOM - POSTGRESQL & CENTRAL BACKEND -->
        <mxCell id="box_backend_db" value="&lt;b style=&quot;font-size: 13px; color: #B45309;&quot;&gt;PostgreSQL Database&lt;/b&gt;&lt;br/&gt;&lt;span style=&quot;font-size: 11px; color: #78350F;&quot;&gt;&amp;amp; Central Backend API&lt;/span&gt;" style="rounded=1;arcSize=12;whiteSpace=wrap;html=1;fillColor=#FEF3C7;strokeColor=#D97706;strokeWidth=2;fontColor=#78350F;align=center;verticalAlign=middle;" vertex="1" parent="1">
          <mxGeometry x="400" y="440" width="300" height="70" as="geometry" />
        </mxCell>

        <!-- BOX 5: RIGHT - OPERATOR DASHBOARD -->
        <mxCell id="box_dashboard" value="&lt;b style=&quot;font-size: 13px; color: #BE185D;&quot;&gt;Operator Mission Control&lt;/b&gt;&lt;br/&gt;&lt;span style=&quot;font-size: 11px; color: #831843;&quot;&gt;Dashboard (HMI)&lt;/span&gt;" style="rounded=1;arcSize=12;whiteSpace=wrap;html=1;fillColor=#FCE7F3;strokeColor=#DB2777;strokeWidth=2;fontColor=#831843;align=center;verticalAlign=middle;" vertex="1" parent="1">
          <mxGeometry x="780" y="250" width="240" height="70" as="geometry" />
        </mxCell>

        <!-- CONNECTORS -->
        <!-- Top Nodes to Center Gateway -->
        <mxCell id="edge_nodes_gw" value="&lt;b&gt;Mesh Network Data&lt;/b&gt;" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;entryX=0.5;entryY=0;entryDx=0;entryDy=0;strokeColor=#334155;strokeWidth=2;fontColor=#0F172A;fontSize=11;exitX=0.5;exitY=1;exitDx=0;exitDy=0;endArrow=classic;startArrow=none;" edge="1" parent="1" source="box_nodes" target="box_gateway">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>

        <!-- Center Gateway to Left AI Model (Bidirectional) -->
        <mxCell id="edge_gw_ai" value="&lt;b&gt;Telemetry &amp;amp; Predictions&lt;/b&gt;" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;entryX=1;entryY=0.5;entryDx=0;entryDy=0;strokeColor=#334155;strokeWidth=2;fontColor=#0F172A;fontSize=11;exitX=0;exitY=0.5;exitDx=0;exitDy=0;endArrow=classic;startArrow=classic;" edge="1" parent="1" source="box_gateway" target="box_aimodel">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>

        <!-- Center Gateway to Bottom DB -->
        <mxCell id="edge_gw_db" value="&lt;b&gt;Persisted Ingestion Lane&lt;/b&gt;" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;entryX=0.5;entryY=0;entryDx=0;entryDy=0;strokeColor=#334155;strokeWidth=2;fontColor=#0F172A;fontSize=11;exitX=0.5;exitY=1;exitDx=0;exitDy=0;endArrow=classic;startArrow=none;" edge="1" parent="1" source="box_gateway" target="box_backend_db">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>

        <!-- Center Gateway to Right Dashboard (Bidirectional Live Stream) -->
        <mxCell id="edge_gw_dash" value="&lt;b&gt;Live Stream (&amp;lt;100ms)&lt;/b&gt;" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;entryX=0;entryY=0.5;entryDx=0;entryDy=0;strokeColor=#334155;strokeWidth=2;fontColor=#0F172A;fontSize=11;exitX=1;exitY=0.5;exitDx=0;exitDy=0;endArrow=classic;startArrow=classic;" edge="1" parent="1" source="box_gateway" target="box_dashboard">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>

        <!-- Left AI Model to Bottom DB/Backend (Bidirectional) -->
        <mxCell id="edge_ai_db" value="&lt;b&gt;Hazard Risk Scores&lt;/b&gt;" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;entryX=0;entryY=0.5;entryDx=0;entryDy=0;strokeColor=#334155;strokeWidth=2;fontColor=#0F172A;fontSize=11;exitX=0.5;exitY=1;exitDx=0;exitDy=0;endArrow=classic;startArrow=classic;" edge="1" parent="1" source="box_aimodel" target="box_backend_db">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>

        <!-- Bottom DB/Backend to Right Dashboard (Bidirectional) -->
        <mxCell id="edge_db_dash" value="&lt;b&gt;WebSockets &amp;amp; REST APIs&lt;/b&gt;" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;entryX=0.5;entryY=1;entryDx=0;entryDy=0;strokeColor=#334155;strokeWidth=2;fontColor=#0F172A;fontSize=11;exitX=1;exitY=0.5;exitDx=0;exitDy=0;endArrow=classic;startArrow=classic;" edge="1" parent="1" source="box_backend_db" target="box_dashboard">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>

      </root>
    </mxGraphModel>
  </diagram>

  <diagram id="detailed-6-box-hld" name="2. 6-Box Detailed HLD">
    <mxGraphModel dx="1200" dy="700" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1150" pageHeight="650" background="#FFFFFF" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />

        <!-- BOX 1: FIELD SENSORS & MESH -->
        <mxCell id="b2_nodes" value="&lt;b style=&quot;font-size: 13px; color: #0369A1;&quot;&gt;Field Nodes &amp;amp; Anchors&lt;/b&gt;&lt;br/&gt;&lt;span style=&quot;font-size: 11px; color: #0C4A6E;&quot;&gt;(LoRa Mesh Network)&lt;/span&gt;" style="rounded=1;arcSize=12;whiteSpace=wrap;html=1;fillColor=#E0F2FE;strokeColor=#0284C7;strokeWidth=2;fontColor=#0C4A6E;align=center;verticalAlign=middle;" vertex="1" parent="1">
          <mxGeometry x="410" y="50" width="280" height="70" as="geometry" />
        </mxCell>

        <!-- BOX 2: GATEWAY & INGESTION -->
        <mxCell id="b2_gateway" value="&lt;b style=&quot;font-size: 13px; color: #047857;&quot;&gt;Master Gateway&lt;/b&gt;&lt;br/&gt;&lt;span style=&quot;font-size: 11px; color: #064E3B;&quot;&gt;&amp;amp; Ingestion Hub&lt;/span&gt;" style="rounded=1;arcSize=12;whiteSpace=wrap;html=1;fillColor=#D1FAE5;strokeColor=#059669;strokeWidth=2;fontColor=#064E3B;align=center;verticalAlign=middle;" vertex="1" parent="1">
          <mxGeometry x="430" y="230" width="240" height="70" as="geometry" />
        </mxCell>

        <!-- BOX 3: AI MODEL -->
        <mxCell id="b2_aimodel" value="&lt;b style=&quot;font-size: 13px; color: #6D28D9;&quot;&gt;AI Predictive Model&lt;/b&gt;&lt;br/&gt;&lt;span style=&quot;font-size: 11px; color: #4C1D95;&quot;&gt;&amp;amp; Hazard Detection&lt;/span&gt;" style="rounded=1;arcSize=12;whiteSpace=wrap;html=1;fillColor=#EDE9FE;strokeColor=#7C3AED;strokeWidth=2;fontColor=#4C1D95;align=center;verticalAlign=middle;" vertex="1" parent="1">
          <mxGeometry x="80" y="230" width="240" height="70" as="geometry" />
        </mxCell>

        <!-- BOX 4: AUTHORITATIVE POSTGRESQL -->
        <mxCell id="b2_postgres" value="&lt;b style=&quot;font-size: 13px; color: #B45309;&quot;&gt;PostgreSQL Database&lt;/b&gt;&lt;br/&gt;&lt;span style=&quot;font-size: 11px; color: #78350F;&quot;&gt;(Time-Series &amp;amp; Ledger)&lt;/span&gt;" style="rounded=1;arcSize=12;whiteSpace=wrap;html=1;fillColor=#FEF3C7;strokeColor=#D97706;strokeWidth=2;fontColor=#78350F;align=center;verticalAlign=middle;" vertex="1" parent="1">
          <mxGeometry x="260" y="440" width="240" height="70" as="geometry" />
        </mxCell>

        <!-- BOX 5: CENTRAL BACKEND & WEBSOCKETS -->
        <mxCell id="b2_backend" value="&lt;b style=&quot;font-size: 13px; color: #1D4ED8;&quot;&gt;Central Backend Server&lt;/b&gt;&lt;br/&gt;&lt;span style=&quot;font-size: 11px; color: #1E3A8A;&quot;&gt;(WebSockets &amp;amp; REST)&lt;/span&gt;" style="rounded=1;arcSize=12;whiteSpace=wrap;html=1;fillColor=#DBEAFE;strokeColor=#2563EB;strokeWidth=2;fontColor=#1E3A8A;align=center;verticalAlign=middle;" vertex="1" parent="1">
          <mxGeometry x="600" y="440" width="240" height="70" as="geometry" />
        </mxCell>

        <!-- BOX 6: OPERATOR DASHBOARD -->
        <mxCell id="b2_dashboard" value="&lt;b style=&quot;font-size: 13px; color: #BE185D;&quot;&gt;Operator Mission Control&lt;/b&gt;&lt;br/&gt;&lt;span style=&quot;font-size: 11px; color: #831843;&quot;&gt;Dashboard (HMI)&lt;/span&gt;" style="rounded=1;arcSize=12;whiteSpace=wrap;html=1;fillColor=#FCE7F3;strokeColor=#DB2777;strokeWidth=2;fontColor=#831843;align=center;verticalAlign=middle;" vertex="1" parent="1">
          <mxGeometry x="780" y="230" width="240" height="70" as="geometry" />
        </mxCell>

        <!-- CONNECTORS PAGE 2 -->
        <!-- Nodes to Gateway -->
        <mxCell id="e2_nodes_gw" value="&lt;b&gt;Mesh Network Data&lt;/b&gt;" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;entryX=0.5;entryY=0;entryDx=0;entryDy=0;strokeColor=#334155;strokeWidth=2;fontColor=#0F172A;fontSize=11;exitX=0.5;exitY=1;exitDx=0;exitDy=0;endArrow=classic;startArrow=none;" edge="1" parent="1" source="b2_nodes" target="b2_gateway">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>

        <!-- Gateway to AI Model (Bidirectional) -->
        <mxCell id="e2_gw_ai" value="&lt;b&gt;Telemetry &amp;amp; Predictions&lt;/b&gt;" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;entryX=1;entryY=0.5;entryDx=0;entryDy=0;strokeColor=#334155;strokeWidth=2;fontColor=#0F172A;fontSize=11;exitX=0;exitY=0.5;exitDx=0;exitDy=0;endArrow=classic;startArrow=classic;" edge="1" parent="1" source="b2_gateway" target="b2_aimodel">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>

        <!-- Gateway to PostgreSQL -->
        <mxCell id="e2_gw_pg" value="&lt;b&gt;Persisted SQL Ingestion&lt;/b&gt;" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;entryX=0.5;entryY=0;entryDx=0;entryDy=0;strokeColor=#334155;strokeWidth=2;fontColor=#0F172A;fontSize=11;exitX=0.25;exitY=1;exitDx=0;exitDy=0;endArrow=classic;startArrow=none;" edge="1" parent="1" source="b2_gateway" target="b2_postgres">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>

        <!-- Gateway to Dashboard (Bidirectional Live Stream) -->
        <mxCell id="e2_gw_dash" value="&lt;b&gt;Live Stream (&amp;lt;100ms)&lt;/b&gt;" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;entryX=0;entryY=0.5;entryDx=0;entryDy=0;strokeColor=#334155;strokeWidth=2;fontColor=#0F172A;fontSize=11;exitX=1;exitY=0.5;exitDx=0;exitDy=0;endArrow=classic;startArrow=classic;" edge="1" parent="1" source="b2_gateway" target="b2_dashboard">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>

        <!-- AI Model to Central Backend (Bidirectional) -->
        <mxCell id="e2_ai_be" value="&lt;b&gt;Hazard Risk Scores&lt;/b&gt;" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;entryX=0;entryY=0.5;entryDx=0;entryDy=0;strokeColor=#334155;strokeWidth=2;fontColor=#0F172A;fontSize=11;exitX=0.5;exitY=1;exitDx=0;exitDy=0;endArrow=classic;startArrow=classic;" edge="1" parent="1" source="b2_aimodel" target="b2_backend">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>

        <!-- PostgreSQL to Central Backend (Bidirectional) -->
        <mxCell id="e2_pg_be" value="&lt;b&gt;Database Queries&lt;/b&gt;" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;entryX=0;entryY=0.5;entryDx=0;entryDy=0;strokeColor=#334155;strokeWidth=2;fontColor=#0F172A;fontSize=11;exitX=1;exitY=0.5;exitDx=0;exitDy=0;endArrow=classic;startArrow=classic;" edge="1" parent="1" source="b2_postgres" target="b2_backend">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>

        <!-- Central Backend to Dashboard (Bidirectional) -->
        <mxCell id="e2_be_dash" value="&lt;b&gt;WebSockets &amp;amp; REST APIs&lt;/b&gt;" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;entryX=0.5;entryY=1;entryDx=0;entryDy=0;strokeColor=#334155;strokeWidth=2;fontColor=#0F172A;fontSize=11;exitX=1;exitY=0.5;exitDx=0;exitDy=0;endArrow=classic;startArrow=classic;" edge="1" parent="1" source="b2_backend" target="b2_dashboard">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>

      </root>
    </mxGraphModel>
  </diagram>
</mxfile>'''
    return xml_content

if __name__ == "__main__":
    xml_str = build_drawio_xml()
    root = ET.fromstring(xml_str)
    print(f"Successfully generated colored light-theme XML with {len(root.findall('diagram'))} diagrams!")
    with open("/Users/adarshagarwala/Documents/sih26/mine_subsidence_hld.drawio", "w", encoding="utf-8") as f:
        f.write(xml_str)
    print("Saved to /Users/adarshagarwala/Documents/sih26/mine_subsidence_hld.drawio")
