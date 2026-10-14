import { createFileRoute } from "@tanstack/react-router";
import { Game } from "@/components/game/Game";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Under Falling Skies — Solo Dice Defense" },
      { name: "description", content: "Play the solo dice-placement game Under Falling Skies on your phone: hold off the mothership and finish your research." },
      { property: "og:title", content: "Under Falling Skies — Solo Dice Defense" },
      { property: "og:description", content: "Place dice, shoot down alien ships and research a weapon before the mothership lands." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => <Game />,
});
