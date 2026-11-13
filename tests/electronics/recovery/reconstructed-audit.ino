// R00 reconstruction from the audit's described behaviour, NOT the owner's source.
// The original project JSON and the complete original sketch were unavailable.
int x = 0;
int v = 0;

void setup() {
  pinMode(2, INPUT);
  pinMode(3, INPUT);
  pinMode(5, OUTPUT);
  pinMode(6, OUTPUT);
  pinMode(9, OUTPUT);
  pinMode(10, OUTPUT);
  pinMode(11, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  if (x > 11) x = 9;
  if (x < 9) x = 11;
  v = analogRead(A5);
  analogWrite(x, v / 4);
  Serial.print(v);
  Serial.print(" ");
  Serial.println(x);
  delay(100);
  if (digitalRead(2) == HIGH) x = x + 1;
  if (digitalRead(3) == HIGH) x = x - 1;
  if (x > 11) x = 9;
  if (x < 9) x = 11;
  analogWrite(x, 0);
  delay(100);
}
