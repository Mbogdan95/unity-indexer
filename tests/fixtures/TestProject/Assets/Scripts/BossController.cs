using UnityEngine;

namespace MyGame.Player
{
    public class BossController : PlayerController
    {
        [SerializeField] private float rageMultiplier = 2f;

        public void Enrage()
        {
            Debug.Log("Enraged: " + rageMultiplier);
        }
    }
}
