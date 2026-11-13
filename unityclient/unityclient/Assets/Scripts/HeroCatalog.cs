using System.Collections.Generic;
using UnityEngine;
using Newtonsoft.Json.Linq;

/// <summary>
/// HeroCatalog - client-side mirror of the server's heroes + modes, used for
/// UI and VFX only (the server remains authoritative for all mechanics).
/// Populated from the server CATALOG message; ships with a built-in fallback
/// so the menu works even before CATALOG arrives.
/// </summary>
public static class HeroCatalog
{
    public class AbilityInfo { public string slot; public string name; public string description; }

    public class HeroInfo
    {
        public string id;
        public string name;
        public string element;
        public string colorHex = "#AAAAAA";
        public string passiveName = "";
        public string passiveDesc = "";
        public readonly List<AbilityInfo> abilities = new List<AbilityInfo>();
        public Color Color => UiKit.ParseHtml(colorHex, Color.gray);
    }

    public class ModeInfo
    {
        public string id;
        public string name;
        public bool enabled;
        public int teams;
        public int teamSize;
    }

    public static readonly List<HeroInfo> Heroes = new List<HeroInfo>();
    public static readonly List<ModeInfo> Modes = new List<ModeInfo>();

    static HeroCatalog()
    {
        BuildFallback();
    }

    public static HeroInfo Get(string id)
    {
        if (string.IsNullOrEmpty(id)) return null;
        return Heroes.Find(h => h.id == id);
    }

    public static Color ColorFor(string heroId)
    {
        var h = Get(heroId);
        return h != null ? h.Color : Color.gray;
    }

    /// <summary>Populate from the server CATALOG payload.</summary>
    public static void Populate(JToken catalog)
    {
        if (catalog == null) return;

        var modes = catalog["modes"] as JArray;
        if (modes != null)
        {
            Modes.Clear();
            foreach (var m in modes)
            {
                Modes.Add(new ModeInfo
                {
                    id = m["id"]?.ToString(),
                    name = m["name"]?.ToString(),
                    enabled = m["enabled"]?.ToObject<bool>() ?? false,
                    teams = m["teams"]?.ToObject<int>() ?? 1,
                    teamSize = m["teamSize"]?.ToObject<int>() ?? 1
                });
            }
        }

        var heroes = catalog["heroes"] as JArray;
        if (heroes != null)
        {
            Heroes.Clear();
            foreach (var h in heroes)
            {
                var info = new HeroInfo
                {
                    id = h["id"]?.ToString(),
                    name = h["name"]?.ToString(),
                    element = h["element"]?.ToString(),
                    colorHex = h["color"]?.ToString() ?? "#AAAAAA",
                    passiveName = h["passive"]?["name"]?.ToString() ?? "",
                    passiveDesc = h["passive"]?["description"]?.ToString() ?? ""
                };
                var abilities = h["abilities"] as JObject;
                if (abilities != null)
                {
                    foreach (var prop in abilities.Properties())
                    {
                        info.abilities.Add(new AbilityInfo
                        {
                            slot = prop.Name,
                            name = prop.Value?["name"]?.ToString() ?? prop.Name,
                            description = prop.Value?["description"]?.ToString() ?? ""
                        });
                    }
                }
                Heroes.Add(info);
            }
        }
    }

    // Built-in fallback mirroring config/heroes.js + config/modes.js
    static void BuildFallback()
    {
        void H(string id, string name, string color, string passive, string pdesc)
        {
            Heroes.Add(new HeroInfo { id = id, name = name, colorHex = color, passiveName = passive, passiveDesc = pdesc });
        }
        H("ice", "Ice Witch", "#7FD4FF", "Frostbite", "Consecutive hits build frost; at max stacks the target is slowed.");
        H("lightning", "Lightning Witch", "#FFE55C", "Static Charge", "Moving continuously builds electricity that boosts your next attack.");
        H("fire", "Fire Witch", "#FF6B35", "Inferno", "Eliminations briefly increase firing speed.");
        H("blood", "Blood Witch", "#B7121A", "Bloodlust", "Eliminations restore a portion of health.");
        H("voodoo", "Voodoo Witch", "#8E44AD", "Toxic Touch", "Weapon hits apply small stacks of poison.");
        H("halo", "Halo Witch", "#F5E663", "Divine Grace", "Staying out of combat gradually regenerates health.");
        H("brujeria", "Brujeria Witch", "#4B367C", "Umbral Veil", "Becomes partially invisible when staying still and not attacking.");
        H("earth", "Earth Witch", "#8C6D46", "Stoneguard", "Takes reduced damage while crouched or standing still.");

        void M(string id, string name, bool enabled, int teams, int size)
        {
            Modes.Add(new ModeInfo { id = id, name = name, enabled = enabled, teams = teams, teamSize = size });
        }
        M("ffa", "Free-for-All", true, 1, 8);
        M("duo", "2v2 Arena", false, 2, 2);
        M("trio", "3v3 Arena", false, 2, 3);
        M("squad", "5v5 Arena", false, 2, 5);
    }
}
