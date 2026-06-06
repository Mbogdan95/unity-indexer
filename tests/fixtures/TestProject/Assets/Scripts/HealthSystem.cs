using UnityEngine;
using System;

namespace MyGame.Player
{
    public class HealthSystem : MonoBehaviour
    {
        public event Action<int> OnDamaged;
        public event Action OnDeath;

        private PlayerController controller;

        private void Start()
        {
            controller = GetComponent<PlayerController>();
            var renderer = GetComponent<MeshRenderer>();
        }

        public void ApplyDamage(int amount)
        {
            PlayerController.StaticMethod();
            OnDamaged?.Invoke(amount);
        }

        private void HandleDeath()
        {
            var spawner = new EnemySpawner();
            OnDeath?.Invoke();
        }
    }

    public class EnemySpawner
    {
        public void SpawnEnemy()
        {
            Debug.Log("Spawn");
        }
    }
}
