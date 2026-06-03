using UnityEngine;
using System;

namespace MyGame.Player
{
    public class PlayerController : MonoBehaviour, IDamageable
    {
        [SerializeField] private float speed = 5.5f;
        [SerializeField] private int health = 100;
        [Header("Weapons")]
        [SerializeField] private GameObject weapon;

        public bool IsAlive => health > 0;

        public float Speed => speed;

        public void TakeDamage(int amount)
        {
            health -= amount;
            if (health <= 0) Die();
        }

        private void Die()
        {
            Destroy(gameObject);
        }

        public void Attack()
        {
            Debug.Log("Attack!");
        }

        private void OnCollisionEnter2D(Collision2D collision)
        {
            var damageable = collision.gameObject.GetComponent<IDamageable>();
            if (damageable != null) damageable.TakeDamage(10);
        }
    }
}
