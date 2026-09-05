#!/usr/bin/env python3
"""
stub-publisher.py — Publishes fake telemetry for one node every 2 seconds.

Usage:
    python3 test/stub-publisher.py [--broker localhost] [--port 1883] [--node N07]

Requires: paho-mqtt  (pip install paho-mqtt)
"""

import json
import time
import random
import argparse

try:
    import paho.mqtt.client as mqtt
except ImportError:
    print("ERROR: paho-mqtt not installed. Run: pip install paho-mqtt")
    raise SystemExit(1)

def main():
    parser = argparse.ArgumentParser(description='R4 stub telemetry publisher')
    parser.add_argument('--broker', default='localhost', help='MQTT broker host')
    parser.add_argument('--port', type=int, default=1883, help='MQTT broker port')
    parser.add_argument('--panel', default='P3', help='Panel ID')
    parser.add_argument('--node', default='N07', help='Node ID')
    parser.add_argument('--interval', type=float, default=2.0, help='Seconds between messages')
    args = parser.parse_args()

    topic = f"mine/{args.panel}/node/{args.node}/telemetry"

    client = mqtt.Client(client_id=f"stub-pub-{args.node}")
    client.connect(args.broker, args.port, 60)
    client.loop_start()

    print(f"Publishing to {topic} every {args.interval}s (Ctrl+C to stop)")

    base_strain = 200
    try:
        while True:
            base_strain += random.randint(-5, 8)
            payload = {
                "node_id": args.node,
                "t_epoch_s": int(time.time()),
                "tilt_x_mdeg": random.randint(50, 300),
                "tilt_y_mdeg": random.randint(-200, 0),
                "strain_ustrain": max(0, base_strain),
                "temp_c_x10": random.randint(280, 350),
                "vbat_mv": random.randint(3400, 3800),
                "vib_rms_summary": random.randint(5, 25),
                "flags": 0,
                "crc8": 0
            }
            client.publish(topic, json.dumps(payload), qos=0)
            print(f"  [{payload['t_epoch_s']}] strain={payload['strain_ustrain']} tilt_x={payload['tilt_x_mdeg']}")
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        client.loop_stop()
        client.disconnect()

if __name__ == '__main__':
    main()
