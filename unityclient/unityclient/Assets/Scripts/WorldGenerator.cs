using UnityEngine;

/// <summary>
/// WorldGenerator - builds a simple test world from primitives:
/// ground plane, scattered blocks, and trees. Seeded so every run
/// produces the same layout. Spawn area around the origin stays clear.
/// </summary>
public class WorldGenerator : MonoBehaviour
{
    public int seed = 1337;
    public float groundSize = 200f;
    public int blockCount = 80;
    public int treeCount = 35;
    public float spawnClearRadius = 8f;

    void Start()
    {
        Generate();
    }

    void Generate()
    {
        var rng = new System.Random(seed);

        // Ground
        var ground = GameObject.CreatePrimitive(PrimitiveType.Cube);
        ground.name = "Ground";
        ground.transform.SetParent(transform, false);
        ground.transform.localScale = new Vector3(groundSize, 1f, groundSize);
        ground.transform.position = new Vector3(0, -0.5f, 0);
        Paint(ground, new Color(0.22f, 0.4f, 0.22f));

        float half = groundSize * 0.45f;

        // Scattered blocks ("buildings")
        for (int i = 0; i < blockCount; i++)
        {
            var pos = RandPos(rng, half);
            if (pos.magnitude < spawnClearRadius) continue;

            float w = 2f + (float)rng.NextDouble() * 6f;
            float h = 1.5f + (float)rng.NextDouble() * 9f;
            float d = 2f + (float)rng.NextDouble() * 6f;

            var block = GameObject.CreatePrimitive(PrimitiveType.Cube);
            block.name = "Block";
            block.transform.SetParent(transform, false);
            block.transform.position = new Vector3(pos.x, h * 0.5f, pos.y);
            block.transform.localScale = new Vector3(w, h, d);
            Paint(block, new Color(
                0.45f + (float)rng.NextDouble() * 0.2f,
                0.4f + (float)rng.NextDouble() * 0.15f,
                0.35f + (float)rng.NextDouble() * 0.15f));
        }

        // Trees (cylinder trunk + sphere canopy)
        for (int i = 0; i < treeCount; i++)
        {
            var pos = RandPos(rng, half);
            if (pos.magnitude < spawnClearRadius) continue;

            var tree = new GameObject("Tree");
            tree.transform.SetParent(transform, false);
            tree.transform.position = new Vector3(pos.x, 0, pos.y);

            float trunkH = 2.5f + (float)rng.NextDouble() * 2f;
            var trunk = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            trunk.transform.SetParent(tree.transform, false);
            trunk.transform.localPosition = new Vector3(0, trunkH * 0.5f, 0);
            trunk.transform.localScale = new Vector3(0.5f, trunkH * 0.5f, 0.5f);
            Paint(trunk, new Color(0.35f, 0.22f, 0.12f));

            var canopy = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            canopy.transform.SetParent(tree.transform, false);
            float cs = 2f + (float)rng.NextDouble() * 2f;
            canopy.transform.localPosition = new Vector3(0, trunkH + cs * 0.4f, 0);
            canopy.transform.localScale = new Vector3(cs, cs * 1.1f, cs);
            Paint(canopy, new Color(0.15f, 0.4f + (float)rng.NextDouble() * 0.2f, 0.15f));
        }

        // Lighting fallback (template scenes already have a directional light)
        if (FindFirstObjectByType<Light>() == null)
        {
            var lightGo = new GameObject("Sun");
            var light = lightGo.AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 1.2f;
            lightGo.transform.rotation = Quaternion.Euler(50f, -30f, 0f);
        }
    }

    static Vector2 RandPos(System.Random rng, float half)
    {
        return new Vector2(
            ((float)rng.NextDouble() * 2f - 1f) * half,
            ((float)rng.NextDouble() * 2f - 1f) * half);
    }

    static void Paint(GameObject go, Color color)
    {
        var shader = Shader.Find("Universal Render Pipeline/Lit");
        if (shader == null) shader = Shader.Find("Standard");
        var mat = new Material(shader) { color = color };
        go.GetComponent<Renderer>().material = mat;
    }
}
