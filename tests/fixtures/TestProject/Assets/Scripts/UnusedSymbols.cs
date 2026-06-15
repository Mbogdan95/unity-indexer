using UnityEngine;
using System.Collections;           // UNUSED: "Collections" never appears as identifier
using System.Collections.Generic;  // USED: List<int> used

namespace MyGame.Test
{
    public class UnusedSymbols : MonoBehaviour
    {
        [SerializeField] private float _serialized = 1f;  // EXEMPT: SerializeField
        private int _usedField = 0;                       // USED: read in Awake
        private string _unusedField;                      // UNUSED
        private List<int> _usedList = new List<int>();    // USED: .Add() called below

        private void Awake()               // EXEMPT: lifecycle
        {
            _usedField = 42;
        }

        public void PublicMethod()         // EXEMPT: public
        {
            _usedList.Add(1);
        }

        private void UsedMethod()          // USED: called by TrulyUnusedMethod
        {
            Debug.Log(_usedField.ToString());
        }

        private void TrulyUnusedMethod()   // UNUSED: never called within file
        {
            UsedMethod();
        }

        private void MethodWithLocals()
        {
            int usedLocal = 5;             // USED
            int unusedLocal = 10;          // UNUSED
            string _exempted = "";         // EXEMPT: _ prefix

            Debug.Log(usedLocal.ToString());
        }
    }

    public class AnotherClass : MonoBehaviour
    {
        private int _neverUsed;            // UNUSED

        private void Start() {}            // EXEMPT: lifecycle
    }
}
