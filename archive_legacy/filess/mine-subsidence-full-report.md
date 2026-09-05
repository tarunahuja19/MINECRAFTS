# Mine Subsidence Early-Warning System — Full Report

*Written in plain, simple language. Every important technical claim below was checked against a real outside source before being included — the source list is at the end, and anything that's an estimate (not a confirmed fact) is labeled as one.*

---

## 1. The Big Picture — What This Project Actually Does

Imagine the ground above an underground coal mine is like the crust on top of a pie that's slowly being hollowed out from underneath. Most of the time nothing happens. But sometimes, over weeks or months, that crust starts to sag, crack, or — rarely — suddenly cave in. This is called **subsidence**, and it can damage roads, homes, and farmland above active mines.

This project builds a network of small, cheap sensor boxes ("nodes") placed on the ground above a mine. Each node quietly watches the ground for early signs of sagging or cracking. If several nodes start seeing the same pattern spread across an area — shaped like a bowl, matching how real subsidence behaves — the system raises an alarm before things get dangerous. The nodes talk to each other wirelessly, so even if the ground damages a few of them, the rest keep working and pass the warning along.

---

## 2. Where We Landed After Trying Hard to Break the Idea

Before trusting any idea, it helps to attack it as hard as possible and see what survives. That's what this section is — a summary of every weak point we found, and how each one gets fixed.

| Weak point we found | Why it matters | The fix |
|---|---|---|
| When the ground actually collapses, many nearby nodes could get damaged **at the same time**, not one at a time | Our plan to compare nearby nodes to cancel out noise depends on having living neighbours nearby — right when we need them most, they might be gone | Put a few extra-accurate reference nodes safely outside the danger zone; if the nearest ring of nodes goes quiet, automatically compare against the next ring out instead |
| A judge might not have the background to follow a detailed physics explanation | The most impressive, most technical part of the project could go over some people's heads | Always have one plain-language version ready ("the sensor's temperature swing is bigger than the real danger signal") next to the technical one |
| If the live demo's wireless signal gets jammed by other devices in a crowded hall, we'd only have a backup video | A recorded video looks the same as if we never built real hardware at all | Test the actual signal in the actual venue the morning of the demo, and be upfront if we plan to show a recording instead of a live test |
| Nobody had touched the embedded programming toolchain (called PlatformIO) before this project | "We'll learn it during the project" is one of the most common ways timelines quietly fall apart | Confirmed: this task now sits with the team's hybrid hardware-and-software member, not left to chance |
| We hadn't checked what fraction of real underground rock failures happen suddenly, without warning | If a judge with mining experience asks this, "we don't know" sounds worse than having an honest number ready | Flagged as something worth a quick, focused search before the pitch is finalized |

None of these were fatal. All of them are fixed or manageable — which is why the honest verdict is still **go**, not **kill**.

---

## 3. Where Do the Nodes Actually Sit? Surface vs. Underground

This matters a lot, so it gets its own section.

The official problem statement says the sensor network sits **on the surface, above the underground mine**, not inside the tunnels. That's the version this whole report is built around.

**Why this matters for sunlight:** on the surface, nodes sit in direct sun, and sun heat genuinely confuses cheap tilt sensors (explained simply in Section 4). Underground, there's no sun — but it's not temperature-stable either. The deeper you go, the naturally warmer it gets (this is a well-known fact called the geothermal gradient), and machines and poor airflow add extra heat too. So even underground, the same kind of "heat confuses the sensor" problem shows up — just from a different, slower cause.

**Why this matters for legal safety rules — the most important part of this section:** coal mines can have methane gas underground. Regular electronics (like a normal ESP32 circuit board) are not allowed to be used in underground areas where that gas might be present, because even a tiny spark from ordinary electronics could set off an explosion. Equipment used underground in gassy areas has to be specially certified as "safe against sparking" (called intrinsically safe or explosion-proof/flameproof), and getting that certification is expensive and slow — not something a student team can do in a few weeks.

**What this means in plain terms:** stick to the surface deployment, exactly as the problem statement describes. If the pitch wants to mention underground sensors as a future idea, that's fine — just be clear and upfront that it's a "maybe later, with proper safety certification" idea, not something built or claimed as working right now. This single point could be a serious, embarrassing gap if a judge with mining safety knowledge catches it and the team wasn't ready for the question. *(Confirmed real requirement — see Source 6.)*

---

## 4. Every Kind of Noise the Sensors Will Face, and How We Fix Each One

Sensors don't just measure the ground — they also pick up all sorts of unwanted "noise" that can look like real danger but isn't. Below is every source of noise we identified, explained simply, with its fix.

### A. Noise from heat and electricity

| Noise | In simple words | The fix |
|---|---|---|
| Sun/heat confusing the tilt sensor | The tiny parts inside a tilt sensor chip physically stretch a little when hot, like a metal ruler getting slightly longer in the sun — so it lies about being tilted | The chip has its own built-in thermometer. We use it to correct the reading with a formula, and also compare against nearby nodes — if they're ALL "tilted" the same way at the same time, it's the sun, not the ground |
| The sensor's own natural shakiness | Even sitting perfectly still on a table, any tiny electronic chip shows a little random jitter in its numbers, just from how the electronics work inside — like a hand that shakes slightly even when you try to hold it perfectly steady | Take many readings and average them together — random jitter cancels itself out the more you average |
| Weak battery | The sensor measures things by comparing to the battery's own voltage, like measuring with a stretchy ruler — as the battery weakens, the "ruler" stretches a little and the reading drifts even though nothing really moved | A small cheap chip that always hands out a steady voltage no matter how weak the battery gets, so the "ruler" never stretches |
| The chip's built-in measuring circuit being a bit inaccurate | The ESP32's own way of turning an electrical signal into a number (its ADC) has known accuracy problems — confirmed by real user reports online, not just a guess (see Source 3) | Add a small, separate, more precise measuring chip (called an external ADC) just for the important sensor |
| Electrical buzz from nearby machines and wires | Power cables and motors give off a bit of invisible electrical noise, like static that leaks into nearby wires, similar to static on a radio | Twist the two signal wires together like a candy cane (this cancels the noise out), and wrap the wire in a metal foil "raincoat" connected to the ground |

### B. Noise from the weather and environment

| Noise | In simple words | The fix |
|---|---|---|
| Rain and humidity | Some cheap sensors act a little like a sponge — in wetter weather, their readings drift slightly | Coat the electronics in a clear waterproof layer (like waterproof nail polish for circuit boards), and periodically double-check against the mine's regular manual ground survey |
| Dust | Dust can clog vents and dirty up electrical contacts over time | Use a sealed, dust-proof box for each sensor |

### C. Noise from events and machines nearby

| Noise | In simple words | The fix |
|---|---|---|
| Planned explosions (blasting) | Mines legally have to record every blast with their own seismograph — that record already exists | Just check the blast log — if a shake happened at a logged blast time, ignore it |
| Trucks driving past | A truck rumbles the ground a little near itself, like footsteps making a nearby glass wobble | We don't even need a special fix here — a truck only shakes 1-2 nearby sensors. Real ground sinking shakes MANY sensors together in a bowl shape. That difference tells them apart automatically |
| Motors and conveyor belts | A motor spins at one steady speed forever, making one steady "hummm" note, like a fan — real rock cracking sounds more like random crackling, not one steady note | A filter that mutes just that one steady note (called a notch filter), leaving everything else untouched |
| Random bumps (an animal, a worker, falling debris) | A bump is one sharp jolt that bounces right back to normal — real ground tilting stays tilted, it doesn't bounce back | If a sudden change appears and then reverts within seconds, throw it out — it's a bump, not a landslide |

### D. Noise related to the sensors themselves getting damaged

| Noise/problem | In simple words | The fix |
|---|---|---|
| One sensor gets destroyed | The ground literally breaks or buries it | The wireless network automatically routes around the missing sensor and keeps working — and treating "this sensor just died" as itself a piece of evidence, not just a data loss |
| **Many sensors near the danger zone get destroyed together** (the trickiest one) | Real ground collapse doesn't damage sensors one at a time and randomly — it damages a whole cluster of them together, right where the danger is | Place a few extra-tough reference sensors safely outside the predicted danger zone; if the closest ring of sensors goes quiet, automatically compare against the next ring out instead |
| A sensor about to be destroyed gives no final warning | Once it's destroyed, it's just silent — we lose the chance to learn from its very last moment | Program it to send one last emergency reading the instant it detects a sudden drop or impact, right before it goes offline |

---

## 5. How We Actually Tell "Real Danger" From "Just Noise"

Think of this as four filters in a row, each one removing a different kind of confusion, so that by the end, only real danger signals are left.

1. **Fix it in the wiring first (free, no code needed).** Twisted wires, foil shielding, a precision measuring chip, a steady voltage supply. This removes a lot of noise before it's even turned into a number.
2. **Clean up each sensor's own readings.** Throw out sudden one-time spikes. Correct for heat using the built-in thermometer. Mute any known steady machine hum.
3. **Turn the reading into a summary, not raw data.** Because the wireless radios can only send tiny amounts of data at a time, each sensor sends a short summary (like "how strong was the shaking, on average, over the last few minutes") instead of the full raw signal. This limitation actually helps — a summary is naturally more resistant to random noise than raw, unprocessed numbers.
4. **Compare sensors to each other.** If many sensors spread across an area all show the same change, forming a bowl-shaped pattern, that's what real subsidence looks like — nothing else creates that exact shape across many sensors at once. This is the strongest and final check before an alarm is raised.

---

## 6. What Will It Actually Cost?

*Prices below are estimates built from real component listings, in Indian Rupees. Exact totals will vary by supplier.*

### Per sensor node (surface deployment)

| Part | Estimated cost (₹) | What it does |
|---|---|---|
| ESP32 + wireless radio board | 600–900 | The "brain" and the "voice" of the sensor |
| Tilt sensor (MPU9250) | 170–450 | Confirmed real India retail pricing (Source 4) |
| Strain / crack sensor | 120–350 | Detects the ground actually stretching or cracking — this is the main signal, more trustworthy than tilt |
| Precision measuring chip (external ADC) | 150–300 | Fixes the accuracy problem in the ESP32's built-in one (confirmed real pricing range, Source 5) |
| Steady-voltage chip | 20–50 | Stops battery weakness from faking a drift |
| Waterproof box | 100–300 | Keeps rain and dust out |
| Battery + small solar panel | 300–600 | Power — the solar panel also uses the sun that was causing noise in the first place |
| Wiring, mounting, misc. | 150–300 | |
| **Total per node** | **~₹1,850–3,650** | |

### Whole-system cost, at different scales

| Scale | How many nodes | Estimated total |
|---|---|---|
| A hackathon stage demo | 3 nodes + gateway | ₹8,000–14,000 |
| A small real test on one mine panel | ~20–30 nodes | ₹60,000–110,000 |
| A full real mine deployment | ~100 nodes | ₹2–4 lakh |

For comparison, professional geotechnical monitoring equipment usually costs far more per single measuring point — this is the honest cost argument for the project, and it only holds for the surface version.

**If underground nodes with safety certification are ever pursued**, the certified protective housing alone typically costs several thousand rupees more *per node*, before counting the electronics — this is a real, separate cost category, not something to fold into the numbers above.

---

## 7. Who Does What — Matched to the Team's Actual Skills

The team has: 3 people strong in software, 3 people strong in hardware, 1 person comfortable in both, and 1 person still building up their skills. Here's how the work splits naturally:

| Stage of the build | Who owns it | What they actually do |
|---|---|---|
| Building a computer model of what real ground sinking looks like, and testing the detection idea against it | The 3 software-strong people | This can start on day one, needs zero hardware, and is where the project's smartest, most original idea lives |
| Checking the wireless network can handle many alarms going off at once | One of the software people, once the model above is working | Either using a network simulator, or — if that's too slow to learn in time — doing the math by hand in a spreadsheet, which is a completely fine fallback |
| Wiring the real sensors, building the waterproof boxes, calibrating against heat | The 3 hardware-strong people | Most of this is well-documented, tutorial-friendly work once parts arrive |
| Writing the one genuinely hard piece of embedded code that connects the sensor readings to the wireless radio | The person comfortable in both hardware and software | This is the single hardest hands-on task in the whole build, so it goes to the person best suited for it, not split randomly |
| Connecting real sensor data into the same detection model built early on; building the map/dashboard | The hybrid person plus one software person | Because the detection model was built first and separately, plugging in real data at the end is simple — swapping the data source, not rebuilding anything |
| Recording a full week of "normal" sensor data before the real test, writing the simple cheat-sheet each teammate needs, prepping the demo script | The newest/still-learning teammate | A genuinely useful, hands-on job that doesn't require deep background knowledge to start contributing right away |

---

## 8. Is This Actually Doable? — The Honest Verdict

**Yes — for the surface version, with this team, in a normal hackathon build window.**

- The hardest, most valuable technical work (the detection idea itself) doesn't need any hardware and can start immediately.
- The one genuinely hard hardware/coding task has a clear, capable owner.
- Every noise problem we found has a specific, buildable fix — nothing on the list requires new invention, just careful engineering.
- The underground version is **not realistic** within this project's time and budget, because of the safety certification requirement explained in Section 3 — it should stay a "future idea," not a built claim.

---

## 9. Ways to Make It Even Better

- **Show exactly where the system is confident and where it isn't**, right on the dashboard — some rock types give plenty of early warning, others (brittle rock) can fail with very little warning at all. Saying this openly, with a simple color-coded map, turns an honest limitation into a trustworthy feature instead of a hidden weak spot.
- **Give a dying sensor one last chance to speak.** The instant a sensor detects a sudden drop or impact (a sign it's about to be destroyed), have it fire off one final emergency reading before going silent — that's useful data from the very moment it matters most.
- **Sync all the sensors' clocks together.** A cheap add-on lets the system also check *timing*, not just location — a truck's shake moves from sensor to sensor at truck speed, while real ground movement develops together, slowly, over hours. This is a second, independent way to catch fakes.
- **Record a full "quiet week" before real monitoring starts**, capturing what normal traffic, machines, and weather actually sound like at that specific site — this makes the system's sense of "normal" much sharper and more site-specific.

---

## 10. Sources Checked Against

Every technical claim above was checked against these real sources before being included in this report. Anything not listed here (like exact rupee totals) is a reasonable estimate built from listed prices, not a confirmed fixed number.

1. **The two uploaded project documents** — `ps-clause-by-clause-mapping.md` and `deep-evaluation-go-no-go.md` — the source for the original problem statement wording, budget assumptions, and prior risk analysis this report builds on.
2. **DGMS (Tech) S&T Circular No. 7 of 1997**, "Damage to the structures due to blast induced ground vibration in the mining areas," Directorate General of Mines Safety, Dhanbad — confirms India's mine safety regulator does mandate blast-vibration monitoring and structural-damage limits. (Cited in: Bhagat et al., Springer, and CIMFR technical reports.)
3. **ESP32 ADC accuracy problems** — confirmed as a real, widely-reported hardware issue through Espressif's own documentation on per-chip reference-voltage variation (1000–1200 mV range) and multiple independent developer bug reports (GitHub: espressif/arduino-esp32 issues #92, #5503; Angrite/esp32-adc-calibrate correction-table project).
4. **MPU9250 sensor** — confirmed as a real, commercially available 9-axis motion sensor with a built-in temperature sensor, and confirmed India retail pricing in the ₹210–450 range (IndiaMART listings).
5. **ADS1115 external precision ADC** — confirmed as a real, widely available 16-bit measurement chip, with international listed prices in the ~₹210–720 range depending on source and quantity.
6. **Underground coal mine electrical safety rules (intrinsic safety / flameproof requirement)** — confirmed as a real, serious requirement through an academic paper on underground longwall mine monitoring system design (arXiv, 2026) and multiple mining-safety regulatory sources (NSW Resources Regulator safety alerts; Chinese coal-mine electrical-safety research) — all independently confirming that non-certified electronics cannot legally be used in gassy underground areas.
7. **India's LoRa radio frequency band (called IN865, 865–867 MHz)** — confirmed as a real, defined regional band with duty-cycle (how-often-you're-allowed-to-transmit) restrictions similar to Europe's band, both through general LoRa regional-band references and the Meshtastic firmware project's own regional configuration documentation (GitHub: meshtastic/firmware).
8. **The Knothe time function** — confirmed as a real, long-established (since 1953) and still widely used scientific model for predicting how mining subsidence develops over time, referenced across many recent peer-reviewed mining engineering papers (Springer, MDPI, and others).
