using System.Collections.Generic;
using UnityEngine;
using Newtonsoft.Json.Linq;
using TMPro;

/// <summary>
/// Marker component so raycasts can resolve a hit collider to a playerId.
/// </summary>
public class RemotePlayerTag : MonoBehaviour
{
    public string playerId;
}

/// <summary>
/// RemotePlayerManager - renders other players from server WORLD_STATE
/// snapshots. The server is the source of truth: avatars are spawned,
/// moved (interpolated), damaged (health bars), killed (hidden), and
/// respawned purely from snapshot data.
/// </summary>
public class RemotePlayerManager : MonoBehaviour
{
    class RemoteAvatar
    {
        public GameObject go;
        public TextMeshPro nameTag;
        public GameObject barRoot;
        public Transform barFill;
        public Vector3 targetPos;
        public float targetYaw;
        public string displayName;
        public string team;
        public int hp = 100;
        public bool alive = true;
    }

    readonly Dictionary<string, RemoteAvatar> remotes = new Dictionary<string, RemoteAvatar>();

    [Tooltip("Interpolation speed - higher = snappier")]
    public float lerpSpeed = 12f;

    const float BarWidth = 1.0f;
    const float BarHeight = 0.12f;

    static readonly Dictionary<string, Color> TeamColors = new Dictionary<string, Color>
    {
        { "red",   new Color(0.86f, 0.08f, 0.24f) },
        { "blue",  new Color(0.12f, 0.56f, 1.00f) },
        { "green", new Color(0.18f, 0.55f, 0.34f) },
    };

    void Start()
    {
        GameNetwork.Instance.OnWorldState += OnWorldState;
    }

    void OnDestroy()
    {
        if (GameNetwork.Instance != null)
            GameNetwork.Instance.OnWorldState -= OnWorldState;
    }

    void OnWorldState(JArray players)
    {
        if (players == null) return;
        var net = GameNetwork.Instance;
        var seen = new HashSet<string>();

        foreach (var p in players)
        {
            var id = p["playerId"]?.ToString();
            if (string.IsNullOrEmpty(id) || id == net.playerId) continue; // skip self
            seen.Add(id);

            var pos = new Vector3(
                p["x"]?.ToObject<float>() ?? 0,
                p["y"]?.ToObject<float>() ?? 0,
                p["z"]?.ToObject<float>() ?? 0);
            var yaw = p["yaw"]?.ToObject<float>() ?? 0;
            var hp = p["hp"]?.ToObject<int>() ?? 100;
            var alive = p["alive"]?.ToObject<bool>() ?? true;

            if (!remotes.TryGetValue(id, out var av))
            {
                av = SpawnAvatar(id, p["displayName"]?.ToString() ?? id,
                                 p["team"]?.ToString() ?? "", pos);
                remotes[id] = av;
            }

            // Respawn = snap to the new position instead of interpolating
            if (!av.alive && alive)
                av.go.transform.position = pos + Vector3.up * 0.9f;

            av.targetPos = pos;
            av.targetYaw = yaw;
            av.hp = hp;
            av.alive = alive;
            av.displayName = p["displayName"]?.ToString() ?? av.displayName;

            UpdateHealthBar(av);
            av.go.SetActive(alive);
        }

        // Remove players that left the world
        var gone = new List<string>();
        foreach (var kv in remotes)
            if (!seen.Contains(kv.Key)) gone.Add(kv.Key);
        foreach (var id in gone)
        {
            Destroy(remotes[id].go);
            remotes.Remove(id);
        }
    }

    void Update()
    {
        float t = 1f - Mathf.Exp(-lerpSpeed * Time.deltaTime);
        foreach (var av in remotes.Values)
        {
            if (!av.alive) continue;
            av.go.transform.position = Vector3.Lerp(av.go.transform.position, av.targetPos + Vector3.up * 0.9f, t);
            var curYaw = av.go.transform.eulerAngles.y;
            av.go.transform.rotation = Quaternion.Euler(0, Mathf.LerpAngle(curYaw, av.targetYaw, t), 0);
        }
    }

    void LateUpdate()
    {
        // Billboard name tags + health bars toward the active camera
        var cam = Camera.main;
        if (cam == null) return;
        foreach (var av in remotes.Values)
        {
            if (!av.alive) continue;
            var rot = Quaternion.LookRotation(av.go.transform.position - cam.transform.position);
            if (av.nameTag != null) av.nameTag.transform.rotation = rot;
            if (av.barRoot != null) av.barRoot.transform.rotation = rot;
        }
    }

    RemoteAvatar SpawnAvatar(string id, string displayName, string team, Vector3 pos)
    {
        var body = GameObject.CreatePrimitive(PrimitiveType.Capsule);
        body.name = "Remote_" + displayName;
        body.transform.SetParent(transform, false);
        body.transform.position = pos + Vector3.up * 0.9f; // capsule center
        Paint(body, TeamColors.TryGetValue(team, out var c) ? c : Color.gray);
        body.AddComponent<RemotePlayerTag>().playerId = id;

        // Name tag (3D TMP text above head)
        var tagGo = new GameObject("NameTag");
        tagGo.transform.SetParent(body.transform, false);
        tagGo.transform.localPosition = new Vector3(0, 1.45f, 0);
        var tag = tagGo.AddComponent<TextMeshPro>();
        tag.text = displayName;
        tag.fontSize = 4;
        tag.alignment = TextAlignmentOptions.Center;
        tag.color = Color.white;
        if (GameUI.GetFont() != null) tag.font = GameUI.GetFont();
        tagGo.transform.localScale = Vector3.one * 0.4f;

        // Health bar (two quads, billboarded)
        var barRoot = new GameObject("HealthBar");
        barRoot.transform.SetParent(body.transform, false);
        barRoot.transform.localPosition = new Vector3(0, 1.15f, 0);

        var bg = GameObject.CreatePrimitive(PrimitiveType.Quad);
        bg.name = "BarBg";
        Destroy(bg.GetComponent<Collider>());
        bg.transform.SetParent(barRoot.transform, false);
        bg.transform.localPosition = Vector3.zero;
        bg.transform.localScale = new Vector3(BarWidth, BarHeight, 1f);
        Paint(bg, new Color(0.1f, 0.1f, 0.1f, 1f), unlit: true);

        var fill = GameObject.CreatePrimitive(PrimitiveType.Quad);
        fill.name = "BarFill";
        Destroy(fill.GetComponent<Collider>());
        fill.transform.SetParent(barRoot.transform, false);
        fill.transform.localPosition = new Vector3(0, 0, -0.01f); // toward camera
        fill.transform.localScale = new Vector3(BarWidth, BarHeight * 0.8f, 1f);
        Paint(fill, Color.green, unlit: true);

        return new RemoteAvatar
        {
            go = body,
            nameTag = tag,
            barRoot = barRoot,
            barFill = fill.transform,
            targetPos = pos,
            targetYaw = 0,
            displayName = displayName,
            team = team,
            hp = 100,
            alive = true
        };
    }

    void UpdateHealthBar(RemoteAvatar av)
    {
        if (av.barFill == null) return;
        float frac = Mathf.Clamp01(av.hp / 100f);
        av.barFill.localScale = new Vector3(BarWidth * frac, BarHeight * 0.8f, 1f);
        av.barFill.localPosition = new Vector3(-BarWidth * (1f - frac) * 0.5f, 0, -0.01f);
        var r = av.barFill.GetComponent<Renderer>();
        if (r != null)
            r.material.color = Color.Lerp(Color.red, Color.green, frac);
    }

    static void Paint(GameObject go, Color color, bool unlit = false)
    {
        Shader shader;
        if (unlit)
        {
            shader = Shader.Find("Universal Render Pipeline/Unlit");
            if (shader == null) shader = Shader.Find("Unlit/Color");
        }
        else
        {
            shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader == null) shader = Shader.Find("Standard");
        }
        go.GetComponent<Renderer>().material = new Material(shader) { color = color };
    }
}
