# Mine Subsidence Early-Warning System — Full Report

*Written in plain, simple language. Every important technical claim below was checked against a real outside source before being included — the source list is at the end, and anything that's an estimate (not a confirmed fact) is labeled as one. This version has been checked word-by-word against the official problem statement text.*

---

## 1. The Big Picture — What This Project Actually Does

Imagine the ground above an underground coal mine is like the crust on top of a pie that's slowly being hollowed out from underneath. Most of the time nothing happens. But sometimes, over weeks or months, that crust starts to sag, crack, or — rarely — suddenly cave in. This is called **subsidence**, and it can damage roads, homes, and farmland above active mines.

This project builds a network of small, cheap sensor boxes ("nodes") placed on the ground above a mine. Each node quietly watches the ground for early signs of sagging or cracking. If several nodes start seeing the same pattern spread across an area — shaped like a bowl, matching how real subsidence behaves — the system raises an alarm before things get dangerous, and sends that alarm straight to the people who need it. The nodes talk to each other wirelessly, so even if the ground damages a few of them, the rest keep working and pass the warning along.

---

## 2. The Real Unique Hook — What Actually Makes This Different

The problem statement itself is titled around building a "wireless surface mesh network for real-time subsidence detection." It's tempting to use that exact phrase as the pitch's big differentiator — but it shouldn't be used that way, and here's why in plain terms: **every single team working on this same problem statement will build a wireless surface mesh network.** That's not a special idea this team came up with — it's the assignment itself. Standing on stage and saying "we built a wireless mesh network to detect subsidence" is just repeating the problem statement back to the judges. It won't separate this team from the other five, ten, or twenty teams who picked the same problem.

The real differences — the things another team building the same generic network almost certainly won't have thought of — are the specific, hard-won choices made throughout this project:

- **Reusing equipment mines are already legally required to have.** Indian coal mines must already run blast-monitoring equipment (seismographs) under DGMS safety rules. Instead of treating every vibration as a mystery to solve from scratch, this system checks the mine's own existing blast records first — this cuts hardware cost and directly attacks the single biggest real-world reason these systems fail: too many false alarms, which makes people stop trusting and eventually switch off the system entirely.
- **Being honest that the "obvious" sensor isn't the best one.** Most teams would assume a tilt sensor is a strong way to detect ground movement. A careful look at the numbers showed its own temperature drift can be bigger than the actual danger signal it's trying to catch — so tilt was deliberately demoted to a backup signal, and stretch/crack sensors were promoted to the main ones instead. That kind of "we checked, and changed our mind" thinking is rare and worth showing off.
- **Planning for sensors dying together, not just one at a time.** A simple mesh network story is "if one sensor breaks, the others reroute around it." This project goes a step further: real ground collapse damages a whole cluster of nearby sensors at once, not one at a time — and the design has a specific answer for that harder, more realistic situation.
- **Showing exactly where the system can't help, instead of hiding it.** Some types of rock can fail with almost no warning at all. Rather than pretending the system catches everything, the plan is to mark those zones clearly on the map — which is a more trustworthy, more mature way to present a safety system than overclaiming.

**The line to use instead of "we built a wireless mesh network" is something closer to:** *"the only team turning a mine's own legally-mandated safety data into a false-alarm filter, and the only one whose network is designed to survive several sensors failing together — not just one at a time."* That's a claim a judge can't say about every other team in the room.

---

## 3. Checking Every Word of the Official Problem Statement

The project's design was checked line-by-line against the exact wording of the official problem statement text. Here's what already matches cleanly, what was genuinely missing, and what's technically true but worth making stronger.

### What already matches, with no changes needed

| What the problem statement asks for | How the project already covers it |
|---|---|
| A surface mesh network above underground mine panels | This is exactly the deployment plan (see Section 5) |
| Tilt/inclination sensors | Included, though intentionally used as a backup signal, not the main one |
| Vibration sensors | Included, with blast-log checking and machine-hum filtering |
| Displacement/stretch sensors | Included as one of the two main signals |
| Crack detection sensors | Included, using a cheap DIY design |
| "LoRa/Zigbee/Wi-Fi mesh" | LoRa-based mesh (Meshtastic) is one of the problem statement's own named options — not a stretch |
| Arduino/ESP32/Raspberry Pi hardware | ESP32 boards for sensors, Raspberry Pi as the gateway option |
| AI/ML using live and historical data | A historical ground-movement model (explained in Section 7) combined with live anomaly detection |
| GIS-based deformation maps and risk zones | Covered by the dashboard's map, plus the "confidence-coverage zoning" idea from Section 11 — worth explicitly calling that a risk-zone map in the pitch |

### What was genuinely missing — and now has a fix

**1. "Change in relative distance between nodes"** — this is its own separate requirement in the problem statement, different from any single sensor's own local reading. Nothing in the design so far directly measured the distance *between* two sensors changing.

*In simple words:* imagine tying a wire tightly between two fixed posts stuck in the ground. If the ground between them stretches even a tiny bit, the wire gets a little tighter or looser, and a small sensor at one end can measure exactly how much. This exact idea — called a wire extensometer — has been a standard, trusted way to measure ground movement between two points for decades (confirmed real and still in use today — see Source 9). *The fix:* add one of these between pairs of anchor points near likely danger zones. As a free bonus, the wireless mesh software (Meshtastic) already keeps track of how strong the signal is between neighbouring sensors — and that signal strength naturally gets weaker if two sensors drift apart (confirmed the software does expose this data — see Source 10). It's a much rougher measurement than the wire method, but it's free, so it's worth using as a second, backup check.

**2. Automated alerts through SMS, email, and a mobile app — and making sure they actually arrive with no network at the site.** Everything designed so far stops at "show an alarm on the dashboard." The problem statement clearly asks for alerts to actually be *delivered* to people, not just displayed on a screen someone has to be looking at — and mine sites are exactly the kind of place where the network needed to deliver that alert might not be there when it matters most.

*In simple words:* this is like the difference between a fire alarm that only lights up a bulb in an empty room, versus one that actually rings a loud bell everyone can hear. But there's a trap here worth naming honestly: a normal "SMS sending service" works by having the gateway make an internet call to a company's server, which then sends the text — so if the site has no internet, that kind of SMS service silently fails too, at the exact moment it's needed most. The real fix has to stop depending on internet at all, and instead depend on the least demanding thing available, falling back in layers:

| Layer | What it needs to work | What happens |
|---|---|---|
| A local siren or warning light at the site | Nothing — just the gateway's own battery | Fires the instant an alarm triggers, no network of any kind needed. This should always be the very first thing that happens |
| A direct text message, sent by a small GSM module on the gateway (using its own SIM card, not an internet service) | Just ordinary cell signal — even old, basic 2G coverage is enough, no internet or Wi-Fi needed | Texts a list of phone numbers — the mine's safety officer, site engineers — the moment the alarm fires |
| Email, the dashboard, and the mobile app | Actual internet | Sends automatically whenever Wi-Fi, ethernet, or mobile data becomes available |

*Why this works:* sending a text message and browsing the internet are two genuinely different things — a phone can send a text with zero data connection, as long as it has any cell signal bars at all. Putting a small, well-established GSM module (confirmed real, cheap, and widely used for exactly this — see Source 12) directly onto the gateway, with its own SIM card, lets it text people straight through the cell network without needing an internet connection anywhere in the chain. If a site genuinely has no cell signal at all (a real possibility near the forest areas the problem statement itself mentions), satellite messaging modules exist for this exact situation — this stays a named "worth pricing before a real deployment" option rather than a built claim, since the best-known cheap product in that space was bought out and stopped selling to new customers.

**3. Offline capability with periodic cloud sync** — mine sites often have weak or no live internet connection. Nothing in the design so far accounted for the system losing its internet connection.

*In simple words:* imagine a diary that a person keeps writing in even when they can't mail it anywhere — then, whenever a mailbox becomes available, all the saved pages get sent at once. *The fix:* have the gateway device save every reading onto its own local memory (a simple memory card is enough) and automatically upload everything the moment an internet connection becomes available again. This is a very standard, well-known pattern in this kind of project and doesn't need to be invented from scratch. This is separate from the alert-delivery fix above — offline sync is about not losing data, while the siren-then-SMS-then-internet stack above is about making sure a person actually gets warned, even during the exact moment the network is down.

### What's technically present but worth making stronger

**"Estimate severity and progression"** — the current plan gives a severity level (like "caution" or "alarm"), which covers "severity." But "progression" means predicting how things will develop over time, which is a stronger claim. The historical ground-movement model already planned for this project (see Section 7) can be reused here almost for free: instead of only saying "this is a level-2 alarm," fit the live readings against that same model and say something like *"at the current rate, this area is expected to reach alarm level in about X days."* That's a much more literal, much more impressive match to the word "progression" than a single static severity label.

---

## 4. Where We Landed After Trying Hard to Break the Idea

Before trusting any idea, it helps to attack it as hard as possible and see what survives. That's what this section is — a summary of every weak point found in the design, and how each one gets fixed.

| Weak point we found | Why it matters | The fix |
|---|---|---|
| When the ground actually collapses, many nearby nodes could get damaged **at the same time**, not one at a time | Our plan to compare nearby nodes to cancel out noise depends on having living neighbours nearby — right when we need them most, they might be gone | Put a few extra-accurate reference nodes safely outside the danger zone; if the nearest ring of nodes goes quiet, automatically compare against the next ring out instead |
| A judge might not have the background to follow a detailed physics explanation | The most impressive, most technical part of the project could go over some people's heads | Always have one plain-language version ready ("the sensor's temperature swing is bigger than the real danger signal") next to the technical one |
| If the live demo's wireless signal gets jammed by other devices in a crowded hall, we'd only have a backup video | A recorded video looks the same as if we never built real hardware at all | Test the actual signal in the actual venue the morning of the demo, and be upfront if we plan to show a recording instead of a live test |
| Nobody had touched the embedded programming toolchain (called PlatformIO) before this project | "We'll learn it during the project" is one of the most common ways timelines quietly fall apart | Confirmed: this task now sits with the team's hybrid hardware-and-software member, not left to chance |
| We hadn't checked what fraction of real underground rock failures happen suddenly, without warning | If a judge with mining experience asks this, "we don't know" sounds worse than having an honest number ready | Flagged as something worth a quick, focused search before the pitch is finalized |

None of these were fatal. All of them are fixed or manageable — which is why the honest verdict is still **go**, not **kill**.

---

## 5. Where Do the Nodes Actually Sit? Surface vs. Underground

This matters a lot, so it gets its own section.

The official problem statement says the sensor network sits **on the surface, above the underground mine**, not inside the tunnels. That's the version this whole report is built around.

**Why this matters for sunlight:** on the surface, nodes sit in direct sun, and sun heat genuinely confuses cheap tilt sensors (explained simply in Section 6). Underground, there's no sun — but it's not temperature-stable either. The deeper you go, the naturally warmer it gets (this is a well-known fact called the geothermal gradient), and machines and poor airflow add extra heat too. So even underground, the same kind of "heat confuses the sensor" problem shows up — just from a different, slower cause.

**Why this matters for legal safety rules — the most important part of this section:** coal mines can have methane gas underground. Regular electronics (like a normal ESP32 circuit board) are not allowed to be used in underground areas where that gas might be present, because even a tiny spark from ordinary electronics could set off an explosion. Equipment used underground in gassy areas has to be specially certified as "safe against sparking" (called intrinsically safe or explosion-proof/flameproof), and getting that certification is expensive and slow — not something a student team can do in a few weeks.

**What this means in plain terms:** stick to the surface deployment, exactly as the problem statement describes. If the pitch wants to mention underground sensors as a future idea, that's fine — just be clear and upfront that it's a "maybe later, with proper safety certification" idea, not something built or claimed as working right now. This single point could be a serious, embarrassing gap if a judge with mining safety knowledge catches it and the team wasn't ready for the question. *(Confirmed real requirement — see Source 6.)*

---

## 6. Every Kind of Noise the Sensors Will Face, and How We Fix Each One

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

## 7. How We Actually Tell "Real Danger" From "Just Noise" — and Get the Warning to People

Think of this as five steps in a row, each one removing a different kind of confusion, ending with the warning actually reaching someone.

1. **Fix it in the wiring first (free, no code needed).** Twisted wires, foil shielding, a precision measuring chip, a steady voltage supply. This removes a lot of noise before it's even turned into a number.
2. **Clean up each sensor's own readings.** Throw out sudden one-time spikes. Correct for heat using the built-in thermometer. Mute any known steady machine hum.
3. **Turn the reading into a summary, not raw data.** Because the wireless radios can only send tiny amounts of data at a time, each sensor sends a short summary (like "how strong was the shaking, on average, over the last few minutes") instead of the full raw signal. This limitation actually helps — a summary is naturally more resistant to random noise than raw, unprocessed numbers.
4. **Compare sensors to each other.** If many sensors spread across an area all show the same change, forming a bowl-shaped pattern, that's what real subsidence looks like — nothing else creates that exact shape across many sensors at once. This is the strongest check before an alarm is raised, and it's also where the "how fast is this developing" projection from Section 3 gets calculated.
5. **Actually deliver the warning — starting with what needs no network at all.** An alarm that only appears on a screen nobody is watching hasn't really warned anyone. The moment an alarm is raised: a local siren fires immediately (needs nothing but the gateway's own battery), a direct text message goes out over a GSM module's own cell connection (needs only basic signal, not internet), and email/dashboard/app alerts go out too, whenever internet happens to be available. Meanwhile, every reading is also being saved locally the whole time, so nothing is lost even during a total network outage — it all uploads automatically the moment a connection comes back.

---

## 8. What Will It Actually Cost?

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

### Extra cost to cover the gaps found in Section 3

| Addition | Estimated cost | Why |
|---|---|---|
| Wire extensometer kit (per anchor pair, not per node) | ₹200–500 | Directly measures the "change in relative distance between nodes" the problem statement explicitly asks for |
| GSM module with SIM card, on the gateway | ₹350–700 for the module, plus a low-cost SIM with basic recharge (~₹100–200/month covers this level of texting) | Sends direct SMS over the cell network with no internet required — the real fix for a site with no network (see Source 12) |
| Local siren / warning light on the gateway | ₹150–400 | Zero-network, always-works first alert — fires straight off the gateway's own battery |
| Offline storage on the gateway | ₹100–150 one-time (a simple memory card) | Lets the system keep working and catch up later if internet drops |
| Optional: SMS gateway API, only as the internet-available fallback path for app/dashboard-triggered alerts, not the primary alert path | ~₹0.10–0.25 per message, pay-as-you-go | Confirmed real, current India transactional SMS pricing (Source 11) — useful once internet is back, not a substitute for the GSM module above |

### Whole-system cost, at different scales

| Scale | How many nodes | Estimated total |
|---|---|---|
| A hackathon stage demo | 3 nodes + gateway | ₹8,000–14,000 |
| A small real test on one mine panel | ~20–30 nodes | ₹60,000–110,000 |
| A full real mine deployment | ~100 nodes | ₹2–4 lakh |

For comparison, professional geotechnical monitoring equipment usually costs far more per single measuring point — this is the honest cost argument for the project, and it only holds for the surface version.

**If underground nodes with safety certification are ever pursued**, the certified protective housing alone typically costs several thousand rupees more *per node*, before counting the electronics — this is a real, separate cost category, not something to fold into the numbers above.

---

## 9. Who Does What — Matched to the Team's Actual Skills

The team has: 3 people strong in software, 3 people strong in hardware, 1 person comfortable in both, and 1 person still building up their skills. Here's how the work splits naturally:

| Stage of the build | Who owns it | What they actually do |
|---|---|---|
| Building a computer model of what real ground sinking looks like, and testing the detection idea against it | The 3 software-strong people | This can start on day one, needs zero hardware, and is where the project's smartest, most original idea lives |
| Checking the wireless network can handle many alarms going off at once | One of the software people, once the model above is working | Either using a network simulator, or — if that's too slow to learn in time — doing the math by hand in a spreadsheet, which is a completely fine fallback |
| Wiring the real sensors, building the waterproof boxes, calibrating against heat, building the wire extensometer | The 3 hardware-strong people | Most of this is well-documented, tutorial-friendly work once parts arrive |
| Writing the one genuinely hard piece of embedded code that connects the sensor readings to the wireless radio | The person comfortable in both hardware and software | This is the single hardest hands-on task in the whole build, so it goes to the person best suited for it, not split randomly |
| Connecting real sensor data into the same detection model built early on; building the map/dashboard; wiring up SMS and email alerts | The hybrid person plus one software person | Because the detection model was built first and separately, plugging in real data at the end is simple — swapping the data source, not rebuilding anything |
| Recording a full week of "normal" sensor data before the real test, writing the simple cheat-sheet each teammate needs, prepping the demo script | The newest/still-learning teammate | A genuinely useful, hands-on job that doesn't require deep background knowledge to start contributing right away |

---

## 10. Is This Actually Doable? — The Honest Verdict

**Yes — for the surface version, with this team, in a normal hackathon build window.**

- The hardest, most valuable technical work (the detection idea itself) doesn't need any hardware and can start immediately.
- The one genuinely hard hardware/coding task has a clear, capable owner.
- Every noise problem we found has a specific, buildable fix — nothing on the list requires new invention, just careful engineering.
- All three gaps found against the official problem statement text (relative distance between nodes, delivered alerts, offline capability) have simple, low-cost, well-understood fixes — none of them threaten the timeline.
- The underground version is **not realistic** within this project's time and budget, because of the safety certification requirement explained in Section 5 — it should stay a "future idea," not a built claim.

---

## 11. Ways to Make It Even Better

- **Show exactly where the system is confident and where it isn't**, right on the dashboard — some rock types give plenty of early warning, others (brittle rock) can fail with very little warning at all. Saying this openly, with a simple color-coded map, turns an honest limitation into a trustworthy feature instead of a hidden weak spot.
- **Give a dying sensor one last chance to speak.** The instant a sensor detects a sudden drop or impact (a sign it's about to be destroyed), have it fire off one final emergency reading before going silent — that's useful data from the very moment it matters most.
- **Sync all the sensors' clocks together.** A cheap add-on lets the system also check *timing*, not just location — a truck's shake moves from sensor to sensor at truck speed, while real ground movement develops together, slowly, over hours. This is a second, independent way to catch fakes.
- **Record a full "quiet week" before real monitoring starts**, capturing what normal traffic, machines, and weather actually sound like at that specific site — this makes the system's sense of "normal" much sharper and more site-specific.
- **Say "reaches alarm level in about X days," not just "this is level 2."** Reusing the historical ground-movement model to project forward, not just classify the current moment, is a small addition that directly and literally answers the problem statement's request for "progression," not just "severity."

---

## 12. Sources Checked Against

Every technical claim above was checked against these real sources before being included in this report. Anything not listed here (like exact rupee totals) is a reasonable estimate built from listed prices, not a confirmed fixed number.

1. **The two uploaded project documents** — `ps-clause-by-clause-mapping.md` and `deep-evaluation-go-no-go.md` — the source for the original problem statement wording, budget assumptions, and prior risk analysis this report builds on.
2. **DGMS (Tech) S&T Circular No. 7 of 1997**, "Damage to the structures due to blast induced ground vibration in the mining areas," Directorate General of Mines Safety, Dhanbad — confirms India's mine safety regulator does mandate blast-vibration monitoring and structural-damage limits. (Cited in: Bhagat et al., Springer, and CIMFR technical reports.)
3. **ESP32 ADC accuracy problems** — confirmed as a real, widely-reported hardware issue through Espressif's own documentation on per-chip reference-voltage variation (1000–1200 mV range) and multiple independent developer bug reports (GitHub: espressif/arduino-esp32 issues #92, #5503; Angrite/esp32-adc-calibrate correction-table project).
4. **MPU9250 sensor** — confirmed as a real, commercially available 9-axis motion sensor with a built-in temperature sensor, and confirmed India retail pricing in the ₹210–450 range (IndiaMART listings).
5. **ADS1115 external precision ADC** — confirmed as a real, widely available 16-bit measurement chip, with international listed prices in the ~₹210–720 range depending on source and quantity.
6. **Underground coal mine electrical safety rules (intrinsic safety / flameproof requirement)** — confirmed as a real, serious requirement through an academic paper on underground longwall mine monitoring system design (arXiv, 2026) and multiple mining-safety regulatory sources (NSW Resources Regulator safety alerts; Chinese coal-mine electrical-safety research) — all independently confirming that non-certified electronics cannot legally be used in gassy underground areas.
7. **India's LoRa radio frequency band (called IN865, 865–867 MHz)** — confirmed as a real, defined regional band with duty-cycle (how-often-you're-allowed-to-transmit) restrictions similar to Europe's band, both through general LoRa regional-band references and the Meshtastic firmware project's own regional configuration documentation (GitHub: meshtastic/firmware).
8. **The Knothe time function** — confirmed as a real, long-established (since 1953) and still widely used scientific model for predicting how mining subsidence develops over time, referenced across many recent peer-reviewed mining engineering papers (Springer, MDPI, and others).
9. **Wire extensometers for measuring ground-point distance change** — confirmed as a real, decades-old, still-used geophysical technique (Duffield & Burford, "An Accurate Invar-Wire Extensometer," USGS, 1973 — total system cost noted as roughly $300, requiring only 1–2 days to install), and further confirmed as a standard geotechnical instrument category through multiple patent and engineering references.
10. **Meshtastic exposing signal-strength (SNR/RSSI) data between nodes** — confirmed through the Meshtastic open-source project's own community tools, which explicitly read and report per-node SNR/signal data (GitHub: SpudGunMan/meshing-around).
11. **India transactional SMS API pricing** — confirmed real, current listed pricing around ₹0.15 per SMS for Pan-India transactional SMS gateway services (IndiaMART), consistent with standard pay-as-you-go providers like MSG91 and Textlocal. This is the internet-dependent fallback path, not the primary no-network alert method — see Source 12.
12. **GSM modules (e.g., SIM800L) sending SMS directly over the cellular network, independent of Wi-Fi or internet** — confirmed as a real, cheap, extremely well-documented approach used across many independent hardware projects and tutorials (multiple SIM800L/Arduino and Raspberry Pi integration guides and open-source libraries). Worth noting: 2G networks are being phased out in some regions over time, so current local coverage should be checked before a real deployment.
