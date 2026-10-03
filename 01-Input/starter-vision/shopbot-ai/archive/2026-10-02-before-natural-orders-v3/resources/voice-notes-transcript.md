# ShopBot AI — Voice Notes Transcript

Compiled 2026-09-30 from voice notes sent via WhatsApp on 2026-09-29 and 2026-09-30.
These are auto-transcripts, lightly cleaned for readability. Nothing has been added —
only filler and garbled passages were tidied. `[garbled]` marks spots the transcription
could not capture clearly.

---

## 1. 2026-09-29 — The business model (first explanation)

"This is a project I am building. My plan: a store having a lot of items. In their
video they say 'DM and get the product details and order it via WhatsApp' — that kind
of thing. So in that moment we can sell this product.

When someone comes from clicking their link on the Instagram page (or any other
platform) into WhatsApp, they click and an automated message appears in the chat box.
It is sent automatically. Then the bot replies with the product details, like that.

For that, we can sell this product to a bunch of people. We are solving this kind of
problem, and this is worth 10,000 rupees one-time setup and 1,000 recurring fee.

Earlier bots were just static — built once, replying with a few fixed tools. But this
fully works inside WhatsApp. Setup used to take too much time, but we leverage AI to
do the setup, so it goes rapidly, and we do the same thing again and again.

I sent you this video so you can make a promo video like it — same look and feel.
Then go on the internet, find the right customers — people selling on Instagram,
Facebook, anywhere. [Request to collect their mobile numbers, email IDs and social
IDs for outreach — declined; manual one-by-one outreach agreed instead.]

Then make good short messages explaining what it is, asking them to watch the video
to the end, saying 'you are struggling with this currently, and this is what we do.'

In the promo, show their products — in their video they usually say 'this is the
product, message this number.' We can take their product photos, clean them up, or
generate clean versions, making their products look better. That's the target.

Daily, get 50 to 100 prospects, slowly, one by one — that process is best, I believe.
This version is 10,000 + 1,000 recurring, plus an AI fee on top."

## 2. 2026-09-29 — Follow-up on prospecting

"Okay, but Instagram and Facebook have the collected data, and we are targeting the
same people — so you can go and find out their IDs, and I'll message them. What
about that?"

## 3. 2026-09-29 — Browser question

"Can you use a CDP key here to enter into the browser and do everything headlessly?
That is possible, right? I did it with [garbled] before."

## 4. 2026-09-30 — Technical architecture

"I want to explain my business; classify it based on the Meta regulations and things
like that.

We are making a WhatsApp bot — you already know about it. It's server-based, we host
the server, and the server is free for us.

We are providing 3,000 message responses for 1,000 rupees per store [AI cost math in
this passage was garbled in transcription].

The backend is simple: create an agent, the agent has tools — the tools can check
inventory, see what item the customer wants, check the stock, pick the item and tell
the customer the price.

The important part: I have a plan to create an MCP for that program, connect the MCP
to it, and the client connects via the chat. If he wants to add a product, we pick an
image, go through the MCP, and the MCP transfers it to the server via programs —
because with current AI, agents can write programs and do everything without a
developer. So adding and removing products is solved. Otherwise we could build a UI,
but a UI is harder for them to understand and use.

In terms of usability and cost, I haven't seen this kind of system anywhere. Why
don't people build ecommerce inside WhatsApp? I know ecommerce is basically about
exploring things — but this is not an exploring system. You just come and ask what
you need. Or you come from a link with a particular product ID, and that specific
item is shown. Or we build a small recommendation/selection-based system.

The busy part: it's not 100% conversion. Like 100 people come in, maybe 5–10 buy —
we expect around a 5% conversion rate. Previously conversion dropped because of
social media friction [garbled]. Here they already made a little effort to come in,
so making another little effort to buy isn't much — only the price stops them.

Think about everything: how much it would cost, how easy it is for people to
understand, whether people will reuse it again and again.

We are building an agent — a 1-million-token context window is not needed for us;
it's just chat in, chat out, a small thing. Mostly the output tokens matter for cost
because the input is just a sentence. So how much would it cost for the business
owners, and for us? Validate the business — give it a score out of ten."

## 5. 2026-09-30 — Unit economics

"The really important thing: 3,000 message responses we give them, because we collect
1,000 rupees per person. Per person 1,000 rupees, cost around 115 [×2] — it's like
230 rupees only. So the remaining ~75% is profit. Good reasoning, and repeatability
is high, template reuse is high.

Everyone does templates in WhatsApp — I see templates sending promo codes, the same
thing again and again.

Check the current providers you mentioned — AiSensy and the others — are they
building these kinds of things or something else? And do the math: imagine a store
getting 100 customers a day with a 10% conversion ratio — how much does it cost per
customer? Calculate it properly, be mathematical."

## 6. 2026-09-30 — Why competitors don't do this + scale

"Why didn't they pick that line? If everyone uses WhatsApp, we can sell via WhatsApp
— but everyone only suggests using template messages. What is the reason?

I think the coding is the really hard thing — making that, customizing every
back-and-forth for every single store, that kind of problem. What about making an
agent per person — developing a custom one, that kind of problem-solving? I think it
could happen in the future. At large scale it could fail, but at a smaller scale,
with fewer people coming in, it could pass — because at scale, if so many people come
in, [garbled] is the first failure. But we can test it outright. What do you think?

Can you share all the recordings' transcription with me? I am going to work with
another AI agent also — so share everything I talked about."

---

*Earlier voice notes in this chat (2026-09-28): one asking for ways to make money using
glue, and one blank/uncaptured note — not related to ShopBot, excluded above.*
